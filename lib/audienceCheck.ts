// "Check my targeting" — asks the model whether the user's audience + structured
// targeting gives Meta enough to target accurately, and returns concrete gaps +
// fixes. Advisory only (never blocks a launch).

import { runLlamaJson, SMART_MODEL } from "./ai";
import { formatTargetingForModel, type TargetingInput } from "./targeting";

export interface AudienceCheck {
  score: number; // 0–100 readiness
  verdict: string; // one-line summary
  gaps: string[];
  suggestions: string[];
}

const SYSTEM = `You are a Meta Ads targeting reviewer. Given a campaign goal, a free-text audience description, and structured targeting (locations, age, gender), assess whether it gives Meta enough for accurate targeting.
Identify concrete GAPS (e.g. no age range, audience too vague, location too broad or too narrow for the goal, no interest signal, audience/goal mismatch) and concrete SUGGESTIONS to fix each.
Be specific and practical. Never invent facts about the business. Respond with ONLY this JSON:
{"score": <integer 0-100 readiness>, "verdict": "<one sentence>", "gaps": ["..."], "suggestions": ["..."]}
Each gap/suggestion under 140 characters; at most 5 of each.`;

export async function checkAudience(input: {
  goal: string;
  targetAudience: string;
  targeting?: TargetingInput;
}): Promise<AudienceCheck> {
  const targetingBlock =
    input.targeting && formatTargetingForModel(input.targeting)
      ? formatTargetingForModel(input.targeting)
      : "(none provided)";

  const userPrompt = [
    `GOAL: ${input.goal || "(unspecified)"}`,
    `AUDIENCE DESCRIPTION:\n${input.targetAudience || "(empty)"}`,
    `STRUCTURED TARGETING:\n${targetingBlock}`,
    "Assess and return your JSON now.",
  ].join("\n\n");

  const raw = await runLlamaJson<Partial<AudienceCheck>>(SYSTEM, userPrompt, {
    model: SMART_MODEL,
    maxTokens: 700,
    temperature: 0.2,
    kind: "COPILOT",
  });

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5) : [];

  return {
    score: Math.max(0, Math.min(100, Math.round(Number(raw?.score)) || 0)),
    verdict: typeof raw?.verdict === "string" && raw.verdict.trim() ? raw.verdict.trim() : "Review the gaps below.",
    gaps: asStrings(raw?.gaps),
    suggestions: asStrings(raw?.suggestions),
  };
}
