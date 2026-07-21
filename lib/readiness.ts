// AI readiness rating for the pre-flight screen: how well-prepared is this
// campaign, judged against Meta advertising best practices? Returns a 0–100
// score + rationale so the user can feel confident their ad spend is worth it.
// Advisory only — never blocks launch.

import { runLlamaJson, SMART_MODEL } from "./ai";

export interface AiReadiness {
  score: number; // 0–100
  verdict: string; // one-line summary
  strengths: string[];
  improvements: string[];
}

// The model's Meta-ads "training" for judging campaign quality. Kept dense and
// current with how Meta's delivery/learning system actually rewards setups.
const META_BEST_PRACTICES = `You are a senior Meta (Facebook/Instagram) Ads strategist reviewing a campaign before launch. Judge it against these best practices:
- OBJECTIVE↔GOAL: the campaign objective must match the real business goal (leads→OUTCOME_LEADS, sales→OUTCOME_SALES, etc.). Mismatches waste spend.
- AUDIENCE SIZING: too narrow starves delivery and raises CPMs; too broad wastes budget. Local service/event audiences of ~200k–2M are usually healthy. Advantage+ audience can help when signals are thin.
- LOCATION: radius/city targeting should match where customers realistically travel from. Over-broad geo (whole province/country) for a local business is a red flag.
- LEARNING PHASE & BUDGET: Meta needs ~50 optimization events per ad set per week to exit the learning phase. Budget too low for the objective/CPA means the campaign never stabilizes.
- CREATIVE QUALITY: primary text should front-load the hook in ~125 chars, name the offer + differentiation + a clear CTA. Headlines short and benefit-led. Video should hook in the first 3 seconds. Mobile-first, high-contrast.
- CREATIVE VOLUME/FORMAT: 2–4 creatives give delivery room to optimize; testing video vs image is valuable. A single static image is workable but limits learning.
- DESTINATION: a working, relevant, fast landing page that matches the ad's promise; broken/missing URLs kill conversions.
- A/B TESTING: a clean split isolates ONE variable (creative OR audience) with a clear success metric.
- MEASUREMENT: an appropriate optimization goal + attribution window for the objective.
Score holistically 0–100: 90+ = launch-ready and well-optimized; 70–89 = solid with minor gaps; 50–69 = launchable but leaving performance on the table; <50 = meaningful gaps likely to waste spend.`;

const SYSTEM = `${META_BEST_PRACTICES}
Respond with ONLY this JSON (no prose):
{"score": <integer 0-100>, "verdict": "<one sentence>", "strengths": ["..."], "improvements": ["..."]}
List up to 4 strengths and up to 5 improvements, each under 140 characters, concrete and specific to THIS campaign.`;

export async function rateReadiness(input: {
  goal: string;
  objective: string;
  budgetDollars: number;
  budgetType: string;
  durationDays: number;
  targetAudience: string;
  coverage: string;
  creatives: { kind: string; hasMedia: boolean; hasPrimaryText: boolean; hasHeadline: boolean; hasLink: boolean }[];
  abTest: boolean;
  abVariable?: string;
}): Promise<AiReadiness> {
  const userPrompt = [
    "Review this campaign and return your JSON rating.",
    JSON.stringify(input, null, 2),
  ].join("\n\n");

  const raw = await runLlamaJson<Partial<AiReadiness>>(SYSTEM, userPrompt, {
    model: SMART_MODEL,
    maxTokens: 800,
    temperature: 0.2,
    kind: "COPILOT",
  });

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5) : [];

  return {
    score: Math.max(0, Math.min(100, Math.round(Number(raw?.score)) || 0)),
    verdict: typeof raw?.verdict === "string" && raw.verdict.trim() ? raw.verdict.trim() : "Review the notes below before launching.",
    strengths: asStrings(raw?.strengths).slice(0, 4),
    improvements: asStrings(raw?.improvements),
  };
}
