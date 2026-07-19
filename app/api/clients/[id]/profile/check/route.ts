import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";
import { aiRateLimited } from "@/lib/rateLimit";
import { runLlamaJson, SMART_MODEL } from "@/lib/ai";
import { sectionDef, Sections, sectionsFromLegacyMd } from "@/lib/profile";
import { META_ADS_2026_PLAYBOOK, VENUE_EVENTS_2026_PLAYBOOK } from "@/lib/prompts";

const CHECK_SYSTEM_PROMPT = `You are a senior venue-marketing strategist reviewing ONE section of a business owner's marketing strategy. The owner is NOT a marketer — they just finished editing this section and clicked "check my work". Your ONLY output is a single JSON object.

${META_ADS_2026_PLAYBOOK}

${VENUE_EVENTS_2026_PLAYBOOK}

YOUR JOB: identify knowledge GAPS in this section that would make daily ad management harder — information the owner has in their head but hasn't written down. You NEVER rewrite or change their content; you only warn.

RULES
- 0 to 3 warnings, most important first. An empty array means the section is genuinely solid — say so honestly rather than inventing nitpicks.
- Each warning names the missing info, explains in plain English why the ad system needs it, and gives a concrete example of what to add. No jargon.
- Judge against what a media buyer needs for THIS section's job, using the playbooks above and the rest of the profile for context. Do not flag info that already exists elsewhere in the profile.
- Line items are priority-ordered (top = most important in daily decisions). If the ordering looks strategically backwards, one warning may say so.

OUTPUT SCHEMA: {"verdict":"solid"|"gaps","summary":"one warm plain-English sentence for the owner","warnings":[{"missing":"<what's missing, short>","why":"<why ads need it, max 30 words>","example":"<a concrete line they could add>"}]}
Output JSON only.`;

interface CheckResult {
  verdict?: string;
  summary?: string;
  warnings?: { missing: string; why: string; example: string }[];
}

/** "Check my work": AI validation of one section — warnings only, no mutations. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (aiRateLimited(auth.session, req.headers)) {
    return NextResponse.json({ error: "Slow down — too many checks in a row. Try again shortly." }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  const def = sectionDef(String(b.sectionKey ?? ""));
  if (!def) return NextResponse.json({ error: "Unknown section." }, { status: 422 });

  const profile = await prisma.businessProfile.findUnique({ where: { clientId: id } });
  if (!profile) return NextResponse.json({ error: "Build the profile first." }, { status: 422 });
  let sections: Sections = {};
  try {
    sections = JSON.parse(profile.sectionsJson) as Sections;
  } catch {
    sections = sectionsFromLegacyMd(profile.profileMd);
  }
  // Check the just-edited draft when provided, else the saved content.
  const content = typeof b.content === "string" && b.content.trim() ? b.content : (sections[def.key] ?? "");

  const userPrompt = [
    `=== SECTION UNDER REVIEW: "${def.title}" (its job: ${def.hint}) ===`,
    content || "(empty)",
    `=== REST OF THE PROFILE (context — do not flag info already covered here) ===`,
    Object.entries(sections)
      .filter(([k]) => k !== def.key)
      .map(([k, v]) => `[${k}] ${v}`)
      .join("\n"),
    "Review and emit your JSON now.",
  ].join("\n\n");

  try {
    const result = await runLlamaJson<CheckResult>(CHECK_SYSTEM_PROMPT, userPrompt, {
      model: SMART_MODEL,
      maxTokens: 700,
      temperature: 0.3,
      kind: "RESEARCH",
    });
    const warnings = (result.warnings ?? [])
      .filter((w) => w && typeof w.missing === "string")
      .slice(0, 3)
      .map((w) => ({
        missing: String(w.missing).slice(0, 120),
        why: String(w.why ?? "").slice(0, 200),
        example: String(w.example ?? "").slice(0, 200),
      }));
    await log("RESEARCH", `Check-my-work on "${def.title}": ${warnings.length} gap(s).`, { detail: { clientId: id } });
    return NextResponse.json({
      verdict: warnings.length === 0 ? "solid" : "gaps",
      summary: result.summary ?? (warnings.length === 0 ? "This section gives the ad system what it needs." : "A few details would sharpen daily decisions."),
      warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: `Check failed: ${(err as Error).message}` }, { status: 502 });
  }
}
