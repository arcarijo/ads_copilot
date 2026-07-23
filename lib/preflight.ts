import { prisma } from "./db";
import { credsFromClient, envCreds, verifyCredentials } from "./meta";
import {
  assertBudgetAllowed,
  GLOBAL_MAX_DAILY_SPEND_CENTS,
  GLOBAL_MAX_LIFETIME_SPEND_CENTS,
  GuardrailViolation,
} from "./guardrails";
import { CopilotPlan, CreativeInput } from "./types";
import { rateReadiness, type AiReadiness } from "./readiness";
import { isSafePublicUrl } from "./urlSafety";
import { isLaunchEligibleStatus } from "./campaignStatus";

// Form step a check/input maps to, so the UI can offer a jump-to-field button.
export type JumpStep = 1 | 2 | 3 | 4;
export type PreflightCategory = "marketing" | "technical";

export interface PreflightCheck {
  item: string;
  ok: boolean;
  severity: "error" | "warning";
  detail: string;
  category: PreflightCategory;
  jumpStep?: JumpStep;
}

/** A single "what you entered" review row for the Your-Inputs category. */
export interface InputRow {
  label: string;
  value: string;
  jumpStep: JumpStep;
}

export interface PreflightResult {
  ready: boolean; // no blocking errors
  hasWarnings: boolean;
  checks: PreflightCheck[];
  inputs: InputRow[];
  ai?: AiReadiness; // best-effort AI readiness rating (absent if unavailable)
}

interface Questionnaire {
  campaignName?: string;
  goal?: string;
  landingPageUrl?: string;
  targetAudience?: string;
  geography?: string;
  budgetDollars?: number;
  budgetType?: string;
  durationDays?: number;
  abTest?: boolean;
  abVariable?: string;
}

/**
 * Aggressive, read-only pre-launch validation, organized for an at-a-glance
 * confidence check: a review of the user's inputs, a marketing best-practice
 * pass, live technical credential checks, and (best-effort) an AI readiness
 * rating. Errors block launch; warnings are surfaced but non-blocking.
 */
export async function preflightCampaign(
  campaignId: string,
  opts: { includeAi?: boolean } = {},
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const add = (
    item: string,
    ok: boolean,
    severity: "error" | "warning",
    category: PreflightCategory,
    detail: string,
    jumpStep?: JumpStep,
  ) => checks.push({ item, ok, severity, category, detail, jumpStep });

  const loadCampaign = () => prisma.campaign.findUnique({ where: { id: campaignId }, include: { client: true } });
  let found: Awaited<ReturnType<typeof loadCampaign>>;
  try {
    found = await loadCampaign();
  } catch (e) {
    // The client-include triggers decrypt-on-read for the stored Meta token
    // (lib/db.ts); a missing/rotated CREDS_SECRET throws here specifically,
    // distinct from a general DB connectivity failure.
    const message = e instanceof Error ? e.message : String(e);
    const isDecryptFailure = /CREDS_SECRET|auth tag|unable to authenticate/i.test(message);
    throw new Error(
      isDecryptFailure
        ? `Could not decrypt this client's stored Meta credentials (${message}). CREDS_SECRET may be missing or has changed in production — re-verify the client's Meta connection.`
        : `Could not load campaign from the database: ${message}`,
    );
  }
  if (!found) {
    return {
      ready: false,
      hasWarnings: false,
      inputs: [],
      checks: [{ item: "Campaign", ok: false, severity: "error", category: "technical", detail: "Campaign not found." }],
    };
  }
  const campaign = found;

  const q: Questionnaire = (() => {
    try {
      return JSON.parse(campaign.questionnaireJson) as Questionnaire;
    } catch {
      return {};
    }
  })();
  const creatives = (() => {
    try {
      return JSON.parse(campaign.creativesJson) as CreativeInput[];
    } catch {
      return [];
    }
  })();
  let plan: CopilotPlan | null = null;
  try {
    plan = campaign.aiPlanJson ? (JSON.parse(campaign.aiPlanJson) as CopilotPlan) : null;
  } catch {
    plan = null;
  }

  // ---------------- Your inputs (review + edit) ----------------
  const inputs: InputRow[] = [
    { label: "Campaign name", value: campaign.name || "—", jumpStep: 1 },
    { label: "Goal", value: q.goal || "—", jumpStep: 1 },
    { label: "Landing page", value: q.landingPageUrl || "— none —", jumpStep: 1 },
    { label: "Audience", value: q.targetAudience ? truncate(q.targetAudience, 90) : "— none —", jumpStep: 2 },
    { label: "Location", value: q.geography ? truncate(q.geography, 90) : "— none —", jumpStep: 2 },
    { label: "Budget", value: `$${(campaign.budgetCents / 100).toFixed(0)} ${campaign.budgetType.toLowerCase()}`, jumpStep: 3 },
    { label: "Duration", value: `${campaign.durationDays} days`, jumpStep: 3 },
    { label: "Creatives", value: creatives.length ? creatives.map((c) => `${c.label} (${c.kind.toLowerCase()})`).join(", ") : "— none —", jumpStep: 4 },
    { label: "A/B test", value: campaign.abTest ? `On — ${campaign.abVariable?.toLowerCase() ?? "creative"}` : "Off", jumpStep: 4 },
  ];
  if (campaign.directive) inputs.push({ label: "Campaign directive", value: truncate(campaign.directive, 90), jumpStep: 4 });

  // ---------------- Technical ----------------
  // ERROR is launch-eligible: a failed launch leaves the approved plan intact,
  // so the user can retry once the cause is fixed. See lib/campaignStatus.ts.
  add("Campaign status", isLaunchEligibleStatus(campaign.status), "error", "technical",
    campaign.status === "READY"
      ? "Copilot-approved and ready."
      : campaign.status === "ERROR"
        ? "A previous launch attempt failed — the approved plan is unchanged, so you can retry once the flagged cause is resolved."
        : `Status is ${campaign.status}. Must be READY to launch.`);
  add("AI plan", Boolean(plan), "error", "technical", plan ? "Approved plan attached." : "No approved AI plan — run the Copilot review first.");

  // ---------------- Marketing readiness ----------------
  // Landing/destination URL (campaign-level; wired to every creative at submit).
  const hasLanding = Boolean(q.landingPageUrl && isSafePublicUrl(q.landingPageUrl));
  add("Destination URL", hasLanding, "error", "marketing",
    hasLanding ? `Ads point to ${q.landingPageUrl}.` : "No valid landing page URL. Add an https:// destination so clicks have somewhere to go.", 1);

  // Creative content completeness.
  const noPrimary = creatives.filter((c) => !c.primaryText?.trim());
  add("Primary text", noPrimary.length === 0, "warning", "marketing",
    noPrimary.length === 0 ? "Every creative has ad copy." : `${noPrimary.length} creative(s) missing primary text — ads without copy underperform.`, 4);
  const noHeadline = creatives.filter((c) => !c.headline?.trim());
  add("Headlines", noHeadline.length === 0, "warning", "marketing",
    noHeadline.length === 0 ? "Every creative has a headline." : `${noHeadline.length} creative(s) missing a headline.`, 4);

  // Audience specificity.
  const audLen = (q.targetAudience ?? "").trim().length;
  add("Audience detail", audLen >= 40, "warning", "marketing",
    audLen >= 40 ? "Audience is described in enough detail for the AI to target well." : "Audience description is thin — more detail helps the AI build sharper targeting.", 2);

  // Creative volume / format best practice.
  const hasVideo = creatives.some((c) => c.kind === "VIDEO");
  add("Creative mix", creatives.length >= 2 || hasVideo, "warning", "marketing",
    creatives.length >= 2 ? `${creatives.length} creatives give delivery room to optimize.` : hasVideo ? "Video creative included." : "Only one static creative — 2+ creatives (or a video) give Meta more to optimize.", 4);

  if (plan) {
    // Budget within ceiling + global cap.
    try {
      assertBudgetAllowed(plan.campaign.budgetCents, plan.campaign.budgetType, campaign.budgetCeilingCents);
      const cap = plan.campaign.budgetType === "DAILY" ? GLOBAL_MAX_DAILY_SPEND_CENTS : GLOBAL_MAX_LIFETIME_SPEND_CENTS;
      add("Budget", true, "error", "marketing",
        `$${(plan.campaign.budgetCents / 100).toFixed(2)} ${plan.campaign.budgetType.toLowerCase()} — within your $${(campaign.budgetCeilingCents / 100).toFixed(2)} ceiling and the $${(cap / 100).toFixed(2)} global cap.`, 3);
    } catch (e) {
      add("Budget", false, "error", "marketing", e instanceof GuardrailViolation ? e.message : (e as Error).message, 3);
    }

    // Ad sets have geo targeting.
    const missingGeo = plan.adSets.filter((a) => !a.targeting?.geo_locations || Object.keys(a.targeting.geo_locations).length === 0);
    add("Location targeting", missingGeo.length === 0, "error", "marketing",
      missingGeo.length === 0 ? `All ${plan.adSets.length} ad set(s) have location targeting.` : `${missingGeo.length} ad set(s) are missing location targeting.`, 2);

    // Every ad references a valid creative with usable media + destination.
    const labelToCreative = new Map(creatives.map((c) => [c.label, c]));
    const problems: string[] = [];
    for (const ad of plan.ads) {
      const c = labelToCreative.get(ad.creativeLabel);
      if (!c) { problems.push(`Ad "${ad.name}" references missing creative "${ad.creativeLabel}".`); continue; }
      const paths = (c.filePaths ?? []).filter(Boolean);
      if (paths.length === 0) problems.push(`"${c.label}" has no media.`);
      if (c.kind === "CAROUSEL" && paths.length < 2) problems.push(`Carousel "${c.label}" needs 2+ images (has ${paths.length}).`);
      if (!c.linkUrl) problems.push(`"${c.label}" has no destination URL.`);
    }
    add("Creatives", problems.length === 0, "error", "marketing",
      problems.length === 0 ? `${plan.ads.length} ad(s) mapped to complete creatives.` : problems.join(" "), 4);

    // A/B sanity (warning only).
    if (campaign.abTest) {
      const variants = new Set(plan.ads.map((a) => a.variant).filter(Boolean));
      add("A/B split test", variants.size >= 2, "warning", "marketing",
        variants.size >= 2 ? `Split configured with variants ${[...variants].join(", ")}.` : "A/B is on but the plan has one variant — it will launch as a single campaign.", 4);
    }

    // Facebook Page (technical).
    const pageId = campaign.client?.metaPageId || process.env.META_PAGE_ID;
    add("Facebook Page", Boolean(pageId), "error", "technical", pageId ? `Publishing from Page ${pageId}.` : "No Page ID available for this campaign.");
  }

  // Live Meta credential probe (validate_only — nothing is created; technical).
  try {
    const creds = campaign.client ? credsFromClient(campaign.client) : envCreds();
    const v = await verifyCredentials(creds);
    for (const c of v.checks) {
      // Funding is a warning (Meta is the final authority); token/account/page block.
      add(`Meta: ${c.item}`, c.ok, c.item === "Funding source" ? "warning" : "error", "technical", c.detail);
    }
  } catch (e) {
    add("Meta credentials", false, "error", "technical", (e as Error).message);
  }

  // ---------------- AI readiness rating (best-effort) ----------------
  let ai: AiReadiness | undefined;
  if (opts.includeAi !== false && plan) {
    try {
      ai = await rateReadiness({
        goal: q.goal ?? "",
        objective: plan.campaign.objective,
        budgetDollars: campaign.budgetCents / 100,
        budgetType: campaign.budgetType,
        durationDays: campaign.durationDays,
        targetAudience: q.targetAudience ?? "",
        coverage: q.geography ?? "",
        creatives: creatives.map((c) => ({
          kind: c.kind,
          hasMedia: (c.filePaths ?? []).filter(Boolean).length > 0,
          hasPrimaryText: Boolean(c.primaryText?.trim()),
          hasHeadline: Boolean(c.headline?.trim()),
          hasLink: Boolean(c.linkUrl),
        })),
        abTest: campaign.abTest,
        abVariable: campaign.abVariable ?? undefined,
      });
    } catch {
      ai = undefined; // never let the rating block the structural result
    }
  }

  const ready = !checks.some((c) => c.severity === "error" && !c.ok);
  const hasWarnings = checks.some((c) => c.severity === "warning" && !c.ok);
  return { ready, hasWarnings, checks, inputs, ai };
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
