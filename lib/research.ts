import { prisma, log } from "./db";
import { isSafePublicUrl } from "./urlSafety";
import { runLlamaJson, SMART_MODEL } from "./ai";
import { RESEARCH_SYSTEM_PROMPT, MARKET_EXTENSION_SYSTEM_PROMPT } from "./prompts";
import { buildProfileMd, mergeSections, PROFILE_SECTIONS, Sections, sectionsFromLegacyMd } from "./profile";

// ---- Hard research guardrails (anti-spiral) ----
// Research is single-pass by design: fetch a bounded set of known URLs, one
// LLM synthesis call, write the profile, stop. No link-following, no retries
// beyond one, no model-initiated follow-up fetches.
const MAX_PAGES_PER_RUN = 5;
const MAX_RUNS_PER_CLIENT_PER_DAY = 5;
const FETCH_TIMEOUT_MS = 10_000;
const PAGE_CHAR_CAP = 8_000;
const TOTAL_CHAR_CAP = 24_000;

interface ResearchOutput {
  sections?: Sections;
  profileMd?: string; // tolerated for back-compat if the model returns old shape
  markets?: string[] | string;
  summary?: string;
}

function existingSectionsOf(profile: { sectionsJson: string; profileMd: string } | null): Sections {
  if (!profile) return {};
  try {
    const s = JSON.parse(profile.sectionsJson) as Sections;
    if (s && Object.keys(s).length) return s;
  } catch {
    /* fall through */
  }
  return sectionsFromLegacyMd(profile.profileMd);
}

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // Follow redirects manually so every hop is re-validated — a public URL
    // must not be able to bounce us to an internal address.
    let target = url;
    let res: Response;
    for (let hop = 0; ; hop++) {
      if (hop > 3 || !isSafePublicUrl(target)) {
        clearTimeout(timer);
        return null;
      }
      res = await fetch(target, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AdManagerResearch/1.0)" },
        redirect: "manual",
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        target = new URL(location, target).toString();
        continue;
      }
      break;
    }
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, PAGE_CHAR_CAP);
  } catch {
    return null;
  }
}

function normalizeUrl(u: string): string | null {
  const trimmed = u.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProto).toString();
  } catch {
    return null;
  }
}

/**
 * Single-pass research pipeline. type INITIAL builds the ground-truth
 * strategy profile from the client's web presence; MARKET_EXTENSION merges a
 * newly detected market into the existing profile with focused analysis.
 * Rate-limited per client per day; every run is recorded for auditability.
 */
export async function runResearch(
  clientId: string,
  opts: {
    type: "INITIAL" | "MARKET_EXTENSION";
    trigger: string;
    marketDescription?: string;
    // One-off URLs to scrape for THIS run in addition to the client's saved
    // website/socials/GMB (not persisted to the client record).
    extraUrls?: string[];
  }
): Promise<{ status: string; summary?: string }> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { profile: true },
  });

  // Daily rate cap — prevents research spirals no matter who triggers them.
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const runsToday = await prisma.researchRun.count({ where: { clientId, createdAt: { gte: since } } });
  if (runsToday >= MAX_RUNS_PER_CLIENT_PER_DAY) {
    await prisma.researchRun.create({
      data: { clientId, type: opts.type, trigger: opts.trigger, status: "SKIPPED", summary: "Daily research cap reached." },
    });
    return { status: "SKIPPED", summary: `Daily cap of ${MAX_RUNS_PER_CLIENT_PER_DAY} research runs reached.` };
  }

  const run = await prisma.researchRun.create({
    data: { clientId, type: opts.type, trigger: opts.trigger },
  });

  try {
    // Bounded URL set: website + socials + GMB + one-off extras, capped,
    // deduped, no crawling.
    const socials = (JSON.parse(client.socialLinksJson) as string[]) ?? [];
    const urls = [client.website, ...socials, client.gmbUrl, ...(opts.extraUrls ?? [])]
      .map((u) => (u ? normalizeUrl(u) : null))
      .filter((u): u is string => Boolean(u));
    const unique = [...new Set(urls)].slice(0, MAX_PAGES_PER_RUN);

    let corpus = "";
    let fetched = 0;
    for (const url of unique) {
      if (corpus.length >= TOTAL_CHAR_CAP) break;
      const text = await fetchPageText(url);
      if (text) {
        fetched++;
        corpus += `\n\n===== SOURCE: ${url} =====\n${text.slice(0, TOTAL_CHAR_CAP - corpus.length)}`;
      }
    }

    const isExtension = opts.type === "MARKET_EXTENSION";
    const priorSections = existingSectionsOf(client.profile);
    const hasPrior = Object.keys(priorSections).length > 0;
    const systemPrompt = isExtension ? MARKET_EXTENSION_SYSTEM_PROMPT : RESEARCH_SYSTEM_PROMPT;
    const userPrompt = [
      "=== CLIENT RECORD ===",
      JSON.stringify({ name: client.name, website: client.website, contactEmail: client.contactEmail, gmb: client.gmbUrl, socials }),
      // Passing existing sections makes every rebuild additive: preserve + enrich.
      hasPrior ? `=== EXISTING PROFILE SECTIONS (preserve every fact, only enrich/add) ===\n${JSON.stringify(priorSections)}` : "",
      isExtension ? `=== NEW MARKET TO INTEGRATE ===\n${opts.marketDescription ?? "unspecified"}` : "",
      corpus ? `=== SCRAPED WEB CONTENT (${fetched} page(s)) ===${corpus}` : "=== NO WEB CONTENT COULD BE FETCHED — rely on the client record and existing sections; leave unknown sections empty rather than inventing. ===",
      "Produce your JSON now.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const out = await runLlamaJson<ResearchOutput>(systemPrompt, userPrompt, {
      model: SMART_MODEL,
      maxTokens: 2048,
      temperature: 0.4,
      kind: "RESEARCH",
    });

    // Accept the structured shape; tolerate the legacy profileMd shape.
    const incomingSections: Sections =
      out.sections && typeof out.sections === "object"
        ? out.sections
        : out.profileMd
          ? sectionsFromLegacyMd(out.profileMd)
          : {};
    if (Object.keys(incomingSections).length === 0 && !hasPrior) {
      throw new Error("Research model returned no usable sections.");
    }

    // MERGE — never erase existing strategy, only enrich.
    const mergedSections = mergeSections(priorSections, incomingSections);
    const profileMd = buildProfileMd(mergedSections);

    // Defensively normalize markets (string[], comma string, or objects).
    const rawMarkets: unknown = out.markets;
    const normalizedMarkets: string[] = Array.isArray(rawMarkets)
      ? rawMarkets.map((m) => (typeof m === "string" ? m : typeof m === "object" && m ? String((m as { name?: string }).name ?? JSON.stringify(m)) : String(m))).filter(Boolean)
      : typeof rawMarkets === "string"
        ? rawMarkets.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    const existingMarkets: string[] = client.profile ? JSON.parse(client.profile.marketsJson) : [];
    const mergedMarkets = [...new Set([...existingMarkets, ...normalizedMarkets])];

    await prisma.businessProfile.upsert({
      where: { clientId },
      create: { clientId, profileMd, sectionsJson: JSON.stringify(mergedSections), marketsJson: JSON.stringify(mergedMarkets) },
      update: {
        profileMd,
        sectionsJson: JSON.stringify(mergedSections),
        marketsJson: JSON.stringify(mergedMarkets),
        version: { increment: 1 },
      },
    });

    await prisma.researchRun.update({
      where: { id: run.id },
      data: { status: "DONE", pagesFetched: fetched, summary: out.summary ?? "Profile updated." },
    });
    await log("RESEARCH", `${opts.type} research complete (${fetched} pages): ${out.summary ?? ""}`, {
      detail: { clientId, trigger: opts.trigger },
    });
    return { status: "DONE", summary: out.summary };
  } catch (err) {
    const message = (err as Error).message;
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: "FAILED", summary: message } });
    await log("RESEARCH", `Research failed: ${message}`, { level: "ERROR", detail: { clientId } });
    return { status: "FAILED", summary: message };
  }
}

/**
 * Ground truth for AI decisions: client profile if present, else the legacy
 * business_info.md. Leads with the global manager directive, then the
 * platform-specific directive for the platform this decision concerns —
 * e.g. Pinterest wedding-package steering vs LinkedIn corporate steering.
 */
export async function getGroundTruth(clientId?: string | null, platform: string = "META"): Promise<string> {
  if (clientId) {
    const [profile, connection] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { clientId } }),
      prisma.platformConnection.findUnique({
        where: { clientId_platform: { clientId, platform } },
        select: { directive: true, directiveAt: true },
      }),
    ]);
    if (profile) {
      const markets = JSON.parse(profile.marketsJson) as string[];
      // The manager's live directives lead the ground truth so the optimizer
      // weighs the human's current intent above everything else.
      const globalDirective = profile.directive?.trim()
        ? `## MANAGER'S CURRENT DIRECTIVE (highest priority — a human set this${profile.directiveAt ? ` on ${profile.directiveAt.toISOString().slice(0, 10)}` : ""})\n${profile.directive.trim()}\n\n`
        : "";
      const platformDirective = connection?.directive?.trim()
        ? `## ${platform} PLATFORM DIRECTIVE (human steering for this platform specifically${connection.directiveAt ? `, set ${connection.directiveAt.toISOString().slice(0, 10)}` : ""})\n${connection.directive.trim()}\n\n`
        : "";
      return `${globalDirective}${platformDirective}${profile.profileMd}\n\n## Known Markets\n${markets.map((m) => `- ${m}`).join("\n")}`;
    }
  }
  const { readBusinessInfo } = await import("./business");
  return readBusinessInfo();
}
