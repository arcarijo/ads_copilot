// Hardcoded financial guardrails. These are checked BEFORE any Meta API call
// is made and cannot be overridden by AI-generated payloads.

/** Absolute global cap on daily spend for any single campaign: $1,000 CAD. */
export const GLOBAL_MAX_DAILY_SPEND_CENTS = 100_000;

/** Absolute global cap on lifetime spend for any single campaign: $3,000 CAD. */
export const GLOBAL_MAX_LIFETIME_SPEND_CENTS = 300_000;

/** Minimum viable budget per the product spec ($100). */
export const MIN_BUDGET_CENTS = 10_000;

/** If CPA exceeds this floor multiplier x target for 48h, auto-pause. */
export const CPA_KILL_MULTIPLIER = 1.5;

/** Max optimizer actions executed per cron cycle (runaway-loop protection). */
export const MAX_ACTIONS_PER_CYCLE = 10;

export class GuardrailViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailViolation";
  }
}

/**
 * Validates a budget against the hardcoded global caps and (if provided) the
 * DB-enforced per-campaign ceiling. Throws GuardrailViolation on breach.
 */
export function assertBudgetAllowed(
  budgetCents: number,
  budgetType: "DAILY" | "LIFETIME",
  ceilingCents?: number
): void {
  if (!Number.isFinite(budgetCents) || budgetCents <= 0) {
    throw new GuardrailViolation(`Invalid budget value: ${budgetCents}`);
  }
  const globalCap =
    budgetType === "DAILY" ? GLOBAL_MAX_DAILY_SPEND_CENTS : GLOBAL_MAX_LIFETIME_SPEND_CENTS;
  if (budgetCents > globalCap) {
    throw new GuardrailViolation(
      `Budget $${(budgetCents / 100).toFixed(2)} exceeds the hardcoded global ${budgetType.toLowerCase()} cap of $${(globalCap / 100).toFixed(2)}.`
    );
  }
  if (ceilingCents && ceilingCents > 0 && budgetCents > ceilingCents) {
    throw new GuardrailViolation(
      `Budget $${(budgetCents / 100).toFixed(2)} exceeds the user-approved ceiling of $${(ceilingCents / 100).toFixed(2)}. Budget increases require human approval.`
    );
  }
}

/**
 * The optimizer's hard wall: given a current budget and an AI-proposed budget,
 * returns the value that is actually allowed to reach Meta. Never higher than
 * current. Any increase attempt is reported, not executed.
 */
export function clampNoIncrease(currentCents: number, proposedCents: number): {
  allowedCents: number;
  increaseBlocked: boolean;
} {
  if (proposedCents > currentCents) {
    return { allowedCents: currentCents, increaseBlocked: true };
  }
  return { allowedCents: proposedCents, increaseBlocked: false };
}
