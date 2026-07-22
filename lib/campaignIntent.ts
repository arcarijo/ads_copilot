/**
 * Campaign intent — the strategic "what is this campaign FOR?" captured up front,
 * before any Meta mechanics. Owners new to ad spending don't think in objectives,
 * ad sets, or split tests; they think in outcomes ("fill my open house", "get
 * more wedding inquiries"). We capture that intent first, then coach every
 * downstream decision toward it — most importantly the rotation-vs-A/B choice,
 * which is where beginners most often pick the wrong tool.
 *
 * This module is PURE DATA (no prisma/crypto) so the client wizard, the server
 * sanitizer, and the copilot prompt all read from one source of truth. The value
 * is persisted inside Campaign.questionnaireJson — no schema column needed.
 */

export type CampaignIntent = "GET_BOOKINGS" | "PROMOTE_EVENT" | "BUILD_AWARENESS" | "TEST_AND_LEARN";

export const CAMPAIGN_INTENTS: CampaignIntent[] = [
  "GET_BOOKINGS",
  "PROMOTE_EVENT",
  "BUILD_AWARENESS",
  "TEST_AND_LEARN",
];

/** Which creative approach we coach for this intent. */
export type Approach = "ROTATION" | "AB";

export interface IntentDef {
  key: CampaignIntent;
  icon: string;
  label: string;
  tagline: string;
  /** Pre-suggested Step-1 goal (matches the goal <select> options). */
  suggestedGoal: string;
  /** The approach we recommend and coach toward on the Creatives & A/B step. */
  recommend: Approach;
  /** Plain-language reason a beginner should take the recommended approach. */
  whyRecommend: string;
  /** How many / what kind of creatives to add, in owner language. */
  creativeGuidance: string;
  /** Injected into the copilot prompt so the AI plan agrees with the coaching. */
  promptDirective: string;
}

export const INTENT_DEFS: Record<CampaignIntent, IntentDef> = {
  GET_BOOKINGS: {
    key: "GET_BOOKINGS",
    icon: "🎯",
    label: "Get bookings & leads",
    tagline: "Turn ad spend into booking inquiries",
    suggestedGoal: "Booking inquiries",
    recommend: "ROTATION",
    whyRecommend:
      "You want results, not a science experiment. Give Meta 2–3 strong ads and let its algorithm spend more on whichever books the most — you'll get more inquiries per dollar than splitting your budget for a formal test.",
    creativeGuidance:
      "Add 2–3 ads with different angles (a hero photo, a video tour, a clear offer). Meta finds the winner automatically and shifts budget to it.",
    promptDirective:
      "CAMPAIGN INTENT: Direct-response lead generation — optimize for booking inquiries/leads (objective OUTCOME_LEADS). Prefer ONE ad set with 2–3 rotating ads (Meta auto-optimizes delivery) over a forced A/B split.",
  },
  PROMOTE_EVENT: {
    key: "PROMOTE_EVENT",
    icon: "📅",
    label: "Fill a specific event or date",
    tagline: "Sell out an open house, show, or class",
    suggestedGoal: "Booking inquiries",
    recommend: "ROTATION",
    whyRecommend:
      "With a deadline, every day counts — there's no time to wait for a split test to reach a trustworthy result. Run a few urgent, time-sensitive ads and let Meta push the winner harder as the date approaches.",
    creativeGuidance:
      "Add 2–3 ads that lead with the date and urgency (limited spots, countdown). A short video of the space set up for the event works well.",
    promptDirective:
      "CAMPAIGN INTENT: Promote a time-bound event/date. Emphasize urgency and the deadline in the plan. Prefer rotating ads over A/B (a deadline leaves no time for statistical significance). Consider LIFETIME budget pacing toward the event date.",
  },
  BUILD_AWARENESS: {
    key: "BUILD_AWARENESS",
    icon: "📣",
    label: "Get discovered locally",
    tagline: "Put your space in front of new people",
    suggestedGoal: "Brand awareness",
    recommend: "ROTATION",
    whyRecommend:
      "Awareness is about reach — getting in front of as many of the right people as possible — not a head-to-head test. Show your most eye-catching video or carousel broadly and let Meta optimize reach.",
    creativeGuidance:
      "Lead with a video or a carousel of your best spaces. 1–3 ads is plenty; visual impact matters more than the offer here.",
    promptDirective:
      "CAMPAIGN INTENT: Local brand awareness / reach — optimize for reach/impressions among the right local audience. Favor video/carousel creative. Prefer rotating ads over A/B.",
  },
  TEST_AND_LEARN: {
    key: "TEST_AND_LEARN",
    icon: "🔬",
    label: "Test what works before scaling",
    tagline: "Find your winning ad or audience with a clean experiment",
    suggestedGoal: "Booking inquiries",
    recommend: "AB",
    whyRecommend:
      "You already have a sense of what you're doing and want a trustworthy answer. An A/B test splits your budget evenly so Meta can't bias the result — you'll learn which creative or audience truly wins, then put your money behind it.",
    creativeGuidance:
      "Pick ONE thing to test: two different ads (same audience) OR two audiences (same ad). Keep everything else identical so the result is clean.",
    promptDirective:
      "CAMPAIGN INTENT: Controlled experiment to learn. Structure a clean A/B — exactly two variants differing on ONE dimension (creative OR audience), everything else held constant. Label variants A and B.",
  },
};

/** Narrow an unknown value to a valid intent, or null. */
export function toCampaignIntent(v: unknown): CampaignIntent | null {
  return typeof v === "string" && (CAMPAIGN_INTENTS as string[]).includes(v) ? (v as CampaignIntent) : null;
}

/**
 * Does the user's A/B toggle agree with the intent's recommended approach?
 * Returns a coaching nudge when they conflict, or null when aligned.
 */
export function intentApproachNudge(intent: CampaignIntent | null, abTest: boolean): { kind: "suggest-ab" | "suggest-rotation"; message: string } | null {
  if (!intent) return null;
  const def = INTENT_DEFS[intent];
  if (def.recommend === "AB" && !abTest) {
    return {
      kind: "suggest-ab",
      message: `For "${def.label}", a formal A/B split test is the right tool — turn it on above so Meta measures a clean winner.`,
    };
  }
  if (def.recommend === "ROTATION" && abTest) {
    return {
      kind: "suggest-rotation",
      message: `For "${def.label}", you'll usually get more results by turning A/B off and adding 2–3 rotating ads instead — a formal split test splits your budget and needs volume to prove a winner.`,
    };
  }
  return null;
}
