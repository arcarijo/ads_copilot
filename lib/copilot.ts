import { z } from "zod";
import { prisma } from "./db";
import { runLlamaJson, SMART_MODEL } from "./ai";
import { getGroundTruth } from "./research";
import { COPILOT_SYSTEM_PROMPT } from "./prompts";
import { assertBudgetAllowed, MIN_BUDGET_CENTS } from "./guardrails";
import { CopilotResult, CreativeInput, MetaTargeting } from "./types";
import { TargetingInput, formatTargetingForModel, metaGenders } from "./targeting";

const targetingSchema = z.object({
  geo_locations: z.object({
    countries: z.array(z.string()).optional(),
    cities: z.array(z.object({ key: z.string() }).passthrough()).optional(),
    custom_locations: z
      .array(
        z.object({
          latitude: z.number(),
          longitude: z.number(),
          radius: z.number().max(80),
          distance_unit: z.literal("kilometer"),
        })
      )
      .optional(),
  }),
  age_min: z.number().min(18).max(65).optional(),
  age_max: z.number().min(18).max(65).optional(),
  genders: z.array(z.number()).optional(),
  interests: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
  custom_audiences: z.array(z.object({ id: z.string() })).optional(),
  excluded_custom_audiences: z.array(z.object({ id: z.string() })).optional(),
  targeting_automation: z.object({ advantage_audience: z.union([z.literal(0), z.literal(1)]) }).optional(),
});

const planSchema = z.object({
  campaign: z.object({
    name: z.string().min(1),
    objective: z.enum(["OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"]),
    budgetType: z.enum(["DAILY", "LIFETIME"]),
    budgetCents: z.number().int().positive(),
    bidStrategy: z.string().default("LOWEST_COST_WITHOUT_CAP"),
  }),
  adSets: z
    .array(
      z.object({
        name: z.string(),
        optimizationGoal: z.enum(["LEAD_GENERATION", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "OFFSITE_CONVERSIONS", "REACH"]),
        targeting: targetingSchema,
        variant: z.enum(["A", "B"]).optional(),
      })
    )
    .min(1)
    .max(3),
  ads: z
    .array(
      z.object({
        name: z.string(),
        adSetIndex: z.number().int().min(0),
        creativeLabel: z.string(),
        variant: z.enum(["A", "B"]).optional(),
      })
    )
    .min(1),
  rationale: z.string(),
});

const copilotResultSchema = z.union([
  z.object({ status: z.literal("NEEDS_CLARIFICATION"), questions: z.array(z.string()).min(1).max(3) }),
  z.object({
    status: z.literal("READY"),
    plan: planSchema,
    newMarket: z.object({ detected: z.boolean(), description: z.string() }).optional(),
  }),
]);

export interface QuestionnaireInput {
  clientId?: string;
  campaignName: string;
  goal: string;
  targetAudience: string;
  geography: string;
  landingPageUrl?: string;
  budgetDollars: number;
  budgetType: "DAILY" | "LIFETIME";
  durationDays: number;
  creatives: CreativeInput[];
  abTest: boolean;
  abVariable?: "CREATIVE" | "AUDIENCE";
  abNotes?: string;
  campaignDirective?: string;
  targeting?: TargetingInput; // structured, app-validated location + age/gender
  clarificationAnswers?: Record<string, string>;
}

/**
 * Runs the Pre-Launch Copilot: questionnaire + business_info.md -> Llama ->
 * validated CopilotResult (clarifying questions OR a strict Meta-shaped plan).
 * All AI output is schema-validated and budget-checked before it is trusted.
 */
export async function runCopilot(input: QuestionnaireInput): Promise<CopilotResult> {
  const businessInfo = await getGroundTruth(input.clientId);
  const budgetCents = Math.round(input.budgetDollars * 100);

  // Persistent audience assets: real Meta audiences (usable via
  // custom_audiences by id) and targeting blueprints (baseline specs built
  // from the strategy knowledge base, with catalog-validated interests).
  const audienceRows = input.clientId
    ? await prisma.metaAudience.findMany({ where: { clientId: input.clientId, status: "READY" }, orderBy: { createdAt: "desc" } })
    : [];
  const realAudiences = audienceRows.filter((a) => a.metaAudienceId);
  const latestBlueprint = audienceRows.find((a) => a.kind === "BLUEPRINT");
  const validAudienceIds = new Set(realAudiences.map((a) => a.metaAudienceId as string));
  let validInterestIds = new Set<string>();
  if (latestBlueprint) {
    try {
      const spec = JSON.parse(latestBlueprint.specJson) as Partial<MetaTargeting>;
      validInterestIds = new Set((spec.interests ?? []).map((i) => i.id));
    } catch {
      /* blueprint spec unreadable — treat as absent */
    }
  }

  const audienceBlock = [
    realAudiences.length
      ? `SAVED META AUDIENCES (use in targeting via custom_audiences:[{"id":"<meta id>"}] — ONLY these ids exist, never invent one):\n${realAudiences
          .map((a) => `- ${a.name} [${a.kind}] meta_id=${a.metaAudienceId} — ${a.sourceNote}`)
          .join("\n")}`
      : "",
    latestBlueprint
      ? `TARGETING BLUEPRINT (baseline built from the owner's strategy — start from this spec, adjust only with reason):\n${latestBlueprint.specJson}\n(${latestBlueprint.sourceNote})`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    "=== BUSINESS PROFILE ===",
    businessInfo,
    audienceBlock ? `=== PERSISTENT AUDIENCE ASSETS ===\n${audienceBlock}` : "",
    input.campaignDirective?.trim()
      ? `=== CAMPAIGN DIRECTIVE (highest priority for THIS campaign — a human set this; honor it in the plan) ===\n${input.campaignDirective.trim()}`
      : "",
    input.abTest && input.abNotes?.trim()
      ? `=== A/B TEST INTENT (what differs between A and B, and what the optimizer should watch) ===\n${input.abNotes.trim()}`
      : "",
    input.targeting && formatTargetingForModel(input.targeting)
      ? `=== STRUCTURED TARGETING (user-set — build geo_locations from these; honor age/gender exactly) ===\n${formatTargetingForModel(input.targeting)}`
      : "",
    "=== USER QUESTIONNAIRE ===",
    JSON.stringify({ ...input, budgetCents }, null, 2),
    input.clarificationAnswers && Object.keys(input.clarificationAnswers).length
      ? `=== USER'S ANSWERS TO YOUR PREVIOUS QUESTIONS ===\n${JSON.stringify(input.clarificationAnswers, null, 2)}`
      : "",
    "Produce your JSON decision now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await runLlamaJson<unknown>(COPILOT_SYSTEM_PROMPT, userPrompt, {
    model: SMART_MODEL,
    maxTokens: 2048,
    temperature: 0.3,
    kind: "COPILOT",
  });
  const parsed = copilotResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Copilot returned an invalid plan shape: ${parsed.error.issues[0]?.message}`);
  }
  const result = parsed.data as CopilotResult;

  if (result.status === "READY" && result.plan) {
    // Server-side trust boundary: the AI's budget is clamped to the user's, never above.
    if (result.plan.campaign.budgetCents > budgetCents) {
      result.plan.campaign.budgetCents = budgetCents;
    }
    if (budgetCents >= MIN_BUDGET_CENTS) {
      assertBudgetAllowed(result.plan.campaign.budgetCents, result.plan.campaign.budgetType);
    }
    // Every ad must reference a real creative label and a real ad set.
    const labels = new Set(input.creatives.map((c) => c.label));
    for (const ad of result.plan.ads) {
      if (!labels.has(ad.creativeLabel)) {
        throw new Error(`Copilot referenced unknown creative "${ad.creativeLabel}".`);
      }
      if (ad.adSetIndex >= result.plan.adSets.length) {
        throw new Error(`Copilot referenced out-of-range ad set index ${ad.adSetIndex}.`);
      }
    }

    // Anti-hallucination wall: audience ids must belong to this client's saved
    // audiences, and interest ids must come from the catalog-validated
    // blueprint. Anything else is silently stripped before it can reach Meta.
    for (const adSet of result.plan.adSets) {
      const t = adSet.targeting as MetaTargeting;
      if (t.custom_audiences) {
        t.custom_audiences = t.custom_audiences.filter((a) => validAudienceIds.has(a.id));
        if (t.custom_audiences.length === 0) delete t.custom_audiences;
      }
      if (t.excluded_custom_audiences) {
        t.excluded_custom_audiences = t.excluded_custom_audiences.filter((a) => validAudienceIds.has(a.id));
        if (t.excluded_custom_audiences.length === 0) delete t.excluded_custom_audiences;
      }
      if (t.interests) {
        t.interests = t.interests.filter((i) => validInterestIds.has(i.id));
        if (t.interests.length === 0) delete t.interests;
      }
    }

    // The user's explicit age/gender wins over the model's guess (max control).
    if (input.targeting) {
      const tg = input.targeting;
      for (const adSet of result.plan.adSets) {
        const t = adSet.targeting as MetaTargeting;
        if (tg.ageMin !== undefined) t.age_min = tg.ageMin;
        if (tg.ageMax !== undefined) t.age_max = tg.ageMax;
        const g = metaGenders(tg.gender);
        if (g) t.genders = g;
        else delete t.genders;
      }
    }
  }
  return result;
}
