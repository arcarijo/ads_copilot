import { describe, it, expect } from "vitest";
import {
  assertBudgetAllowed,
  clampNoIncrease,
  GuardrailViolation,
  GLOBAL_MAX_DAILY_SPEND_CENTS,
  GLOBAL_MAX_LIFETIME_SPEND_CENTS,
} from "../lib/guardrails";

// These guardrails are the hard wall between the AI and real ad spend. A
// regression here is a "the model spent more than it was allowed to" bug.
describe("assertBudgetAllowed", () => {
  it("allows a budget within the global daily cap", () => {
    expect(() => assertBudgetAllowed(5_000, "DAILY")).not.toThrow();
  });

  it("rejects a budget above the global daily cap", () => {
    expect(() => assertBudgetAllowed(GLOBAL_MAX_DAILY_SPEND_CENTS + 1, "DAILY")).toThrow(GuardrailViolation);
  });

  it("rejects a budget above the global lifetime cap", () => {
    expect(() => assertBudgetAllowed(GLOBAL_MAX_LIFETIME_SPEND_CENTS + 1, "LIFETIME")).toThrow(GuardrailViolation);
  });

  it("rejects a budget above the per-campaign ceiling even when under the global cap", () => {
    expect(() => assertBudgetAllowed(50_000, "DAILY", 20_000)).toThrow(/ceiling/i);
  });

  it("allows a budget at exactly the ceiling", () => {
    expect(() => assertBudgetAllowed(20_000, "DAILY", 20_000)).not.toThrow();
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid budget value %s", (v) => {
    expect(() => assertBudgetAllowed(v, "DAILY")).toThrow(GuardrailViolation);
  });
});

describe("clampNoIncrease", () => {
  it("blocks any increase and keeps the current budget", () => {
    expect(clampNoIncrease(10_000, 15_000)).toEqual({ allowedCents: 10_000, increaseBlocked: true });
  });

  it("permits a decrease", () => {
    expect(clampNoIncrease(10_000, 6_000)).toEqual({ allowedCents: 6_000, increaseBlocked: false });
  });

  it("treats an equal budget as no increase", () => {
    expect(clampNoIncrease(10_000, 10_000)).toEqual({ allowedCents: 10_000, increaseBlocked: false });
  });
});
