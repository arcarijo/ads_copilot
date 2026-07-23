import { describe, it, expect } from "vitest";
import { isLaunchEligibleStatus, LAUNCH_ELIGIBLE_STATUSES } from "../lib/campaignStatus";

// Regression guard for the ERROR-status softlock: a client whose first launch
// failed (Meta permission/billing) had their campaign flipped to ERROR, and the
// preflight status gate then refused every retry ("Must be READY to launch").
// ERROR must stay launch-eligible so a failed launch is always retryable.
describe("isLaunchEligibleStatus", () => {
  it("allows launching a Copilot-approved (READY) campaign", () => {
    expect(isLaunchEligibleStatus("READY")).toBe(true);
  });

  it("allows retrying a campaign whose prior launch failed (ERROR)", () => {
    expect(isLaunchEligibleStatus("ERROR")).toBe(true);
  });

  it("blocks launching before Copilot review clears the campaign", () => {
    expect(isLaunchEligibleStatus("DRAFT")).toBe(false);
    expect(isLaunchEligibleStatus("NEEDS_CLARIFICATION")).toBe(false);
  });

  it("blocks re-launching a campaign that is already live", () => {
    expect(isLaunchEligibleStatus("ACTIVE")).toBe(false);
    expect(isLaunchEligibleStatus("LAUNCHING")).toBe(false);
  });

  it("exposes exactly READY and ERROR as the eligible set", () => {
    expect([...LAUNCH_ELIGIBLE_STATUSES].sort()).toEqual(["ERROR", "READY"]);
  });
});
