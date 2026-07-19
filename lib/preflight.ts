import { prisma } from "./db";
import { credsFromClient, envCreds, verifyCredentials } from "./meta";
import {
  assertBudgetAllowed,
  GLOBAL_MAX_DAILY_SPEND_CENTS,
  GLOBAL_MAX_LIFETIME_SPEND_CENTS,
  GuardrailViolation,
} from "./guardrails";
import { CopilotPlan, CreativeInput } from "./types";

export interface PreflightCheck {
  item: string;
  ok: boolean;
  severity: "error" | "warning";
  detail: string;
}

export interface PreflightResult {
  ready: boolean; // no blocking errors
  hasWarnings: boolean;
  checks: PreflightCheck[];
}

/**
 * Aggressive pre-launch validation. Runs every structural check locally AND a
 * live read-only Meta credential probe, so a launch only proceeds when the plan,
 * budget, creatives, targeting, and account are all genuinely ready. Errors
 * block launch; warnings are surfaced but non-blocking.
 */
export async function preflightCampaign(campaignId: string): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const err = (item: string, ok: boolean, detail: string) =>
    checks.push({ item, ok, severity: "error", detail });
  const warn = (item: string, ok: boolean, detail: string) =>
    checks.push({ item, ok, severity: "warning", detail });

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { client: true },
  });
  if (!campaign) {
    return { ready: false, hasWarnings: false, checks: [{ item: "Campaign", ok: false, severity: "error", detail: "Campaign not found." }] };
  }

  // 1. Status
  err("Campaign status", campaign.status === "READY", `Status is ${campaign.status}. Must be READY (Copilot-approved) to launch.`);

  // 2. Plan present and parseable
  let plan: CopilotPlan | null = null;
  try {
    plan = campaign.aiPlanJson ? (JSON.parse(campaign.aiPlanJson) as CopilotPlan) : null;
  } catch {
    plan = null;
  }
  err("AI plan", Boolean(plan), plan ? "Approved plan attached." : "No approved AI plan — run the Copilot review first.");

  const creatives = (() => {
    try {
      return JSON.parse(campaign.creativesJson) as CreativeInput[];
    } catch {
      return [];
    }
  })();

  if (plan) {
    // 3. Budget within ceiling + global cap
    try {
      assertBudgetAllowed(plan.campaign.budgetCents, plan.campaign.budgetType, campaign.budgetCeilingCents);
      const cap = plan.campaign.budgetType === "DAILY" ? GLOBAL_MAX_DAILY_SPEND_CENTS : GLOBAL_MAX_LIFETIME_SPEND_CENTS;
      err(
        "Budget",
        true,
        `$${(plan.campaign.budgetCents / 100).toFixed(2)} ${plan.campaign.budgetType.toLowerCase()} — within approved ceiling $${(campaign.budgetCeilingCents / 100).toFixed(2)} and global cap $${(cap / 100).toFixed(2)}.`
      );
    } catch (e) {
      const m = e instanceof GuardrailViolation ? e.message : (e as Error).message;
      err("Budget", false, m);
    }

    // 4. Ad sets have geo targeting
    const adSetsMissingGeo = plan.adSets.filter(
      (a) => !a.targeting?.geo_locations || Object.keys(a.targeting.geo_locations).length === 0
    );
    err(
      "Ad set targeting",
      adSetsMissingGeo.length === 0,
      adSetsMissingGeo.length === 0
        ? `All ${plan.adSets.length} ad set(s) have geographic targeting.`
        : `${adSetsMissingGeo.length} ad set(s) missing geo_locations targeting.`
    );

    // 5. Every ad references a valid creative with usable media
    const labelToCreative = new Map(creatives.map((c) => [c.label, c]));
    const creativeProblems: string[] = [];
    for (const ad of plan.ads) {
      const c = labelToCreative.get(ad.creativeLabel);
      if (!c) {
        creativeProblems.push(`Ad "${ad.name}" references missing creative "${ad.creativeLabel}".`);
        continue;
      }
      const paths = (c.filePaths ?? []).filter(Boolean);
      if (paths.length === 0) creativeProblems.push(`Creative "${c.label}" has no media file path.`);
      if (c.kind === "CAROUSEL" && paths.length < 2)
        creativeProblems.push(`Carousel "${c.label}" needs at least 2 images (has ${paths.length}).`);
      if (!c.linkUrl) creativeProblems.push(`Creative "${c.label}" has no destination/landing URL.`);
    }
    err(
      "Creatives",
      creativeProblems.length === 0,
      creativeProblems.length === 0 ? `${plan.ads.length} ad(s) mapped to valid creatives.` : creativeProblems.join(" ")
    );

    // 6. Page id available
    const pageId = campaign.client?.metaPageId || process.env.META_PAGE_ID;
    err("Facebook Page", Boolean(pageId), pageId ? `Publishing from Page ${pageId}.` : "No Page ID available for this campaign.");

    // 7. A/B sanity (warning only — single-variant launches are allowed)
    if (campaign.abTest) {
      const variants = new Set(plan.ads.map((a) => a.variant).filter(Boolean));
      warn(
        "A/B split test",
        variants.size >= 2,
        variants.size >= 2
          ? `A/B test configured with variants: ${[...variants].join(", ")}.`
          : "A/B test is enabled but the plan has only one variant — it will launch as a single (non-split) campaign."
      );
    }
  }

  // 8. Live Meta credential probe (read-only)
  try {
    const creds = campaign.client ? credsFromClient(campaign.client) : envCreds();
    const v = await verifyCredentials(creds);
    for (const c of v.checks) {
      // Funding source is a warning, not a hard block: Meta is the final
      // authority and throws a clean, handled BILLING error at creation time,
      // so we surface the risk without letting a false negative block launch.
      // Token / account status / page access remain blocking errors.
      if (c.item === "Funding source") warn(`Meta: ${c.item}`, c.ok, c.detail);
      else err(`Meta: ${c.item}`, c.ok, c.detail);
    }
  } catch (e) {
    err("Meta credentials", false, (e as Error).message);
  }

  const ready = !checks.some((c) => c.severity === "error" && !c.ok);
  const hasWarnings = checks.some((c) => c.severity === "warning" && !c.ok);
  return { ready, hasWarnings, checks };
}
