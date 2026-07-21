import { describe, it, expect } from "vitest";
import { INTENT_DEFS, CAMPAIGN_INTENTS, toCampaignIntent, intentApproachNudge } from "../lib/campaignIntent";

describe("toCampaignIntent", () => {
  it("accepts known intents and rejects anything else", () => {
    expect(toCampaignIntent("GET_BOOKINGS")).toBe("GET_BOOKINGS");
    expect(toCampaignIntent("TEST_AND_LEARN")).toBe("TEST_AND_LEARN");
    expect(toCampaignIntent("nonsense")).toBeNull();
    expect(toCampaignIntent(42)).toBeNull();
    expect(toCampaignIntent(undefined)).toBeNull();
  });
});

describe("INTENT_DEFS", () => {
  it("has a complete, coherent definition for every intent", () => {
    for (const key of CAMPAIGN_INTENTS) {
      const def = INTENT_DEFS[key];
      expect(def.key).toBe(key);
      expect(def.recommend === "ROTATION" || def.recommend === "AB").toBe(true);
      expect(def.promptDirective.length).toBeGreaterThan(0);
      expect(def.suggestedGoal.length).toBeGreaterThan(0);
    }
  });
});

describe("intentApproachNudge", () => {
  it("nudges toward A/B when the intent wants a test but it's off", () => {
    const n = intentApproachNudge("TEST_AND_LEARN", false);
    expect(n?.kind).toBe("suggest-ab");
  });
  it("nudges toward rotation when a results-intent has A/B on", () => {
    const n = intentApproachNudge("GET_BOOKINGS", true);
    expect(n?.kind).toBe("suggest-rotation");
  });
  it("stays quiet when the choice already matches the recommendation", () => {
    expect(intentApproachNudge("TEST_AND_LEARN", true)).toBeNull();
    expect(intentApproachNudge("GET_BOOKINGS", false)).toBeNull();
    expect(intentApproachNudge("PROMOTE_EVENT", false)).toBeNull();
    expect(intentApproachNudge("BUILD_AWARENESS", false)).toBeNull();
  });
  it("returns null when no intent is chosen", () => {
    expect(intentApproachNudge(null, true)).toBeNull();
    expect(intentApproachNudge(null, false)).toBeNull();
  });
});
