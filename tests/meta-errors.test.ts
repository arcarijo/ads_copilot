import { describe, it, expect } from "vitest";
import { classifyMetaError } from "../lib/meta";
import { MetaErrorBody } from "../lib/types";

// classifyMetaError turns a raw Graph API error body into the typed kind that
// drives alerting (app/api/campaigns/[id]/launch/route.ts) and the message a
// venue owner sees in Audience Studio. It's a regex-heavy classifier with no
// exhaustiveness check from the compiler, so a wording tweak on either side
// (Meta's error text or our regex) can silently misclassify a real failure —
// this suite pins each kind to a realistic error body.
function body(fields: MetaErrorBody["error"]): MetaErrorBody {
  return { error: fields };
}

describe("classifyMetaError", () => {
  it("classifies a declined payment method as BILLING", () => {
    const err = classifyMetaError(
      400,
      body({ message: "Ad Account has no valid payment method.", type: "OAuthException", code: 100, error_subcode: 1885183 })
    );
    expect(err.kind).toBe("BILLING");
    expect(err.humanMessage).toMatch(/billing/i);
  });

  it("classifies a disabled ad account as ACCOUNT_RESTRICTED", () => {
    const err = classifyMetaError(
      400,
      body({ message: "The ad account is restricted or disabled.", type: "OAuthException", code: 200 })
    );
    expect(err.kind).toBe("ACCOUNT_RESTRICTED");
  });

  it("classifies an expired session as TOKEN_INVALID", () => {
    const err = classifyMetaError(
      401,
      body({ message: "Error validating access token: Session has expired.", type: "OAuthException", code: 190 })
    );
    expect(err.kind).toBe("TOKEN_INVALID");
  });

  it("classifies a rate-limit code as RATE_LIMIT", () => {
    const err = classifyMetaError(
      400,
      body({ message: "Application request limit reached", type: "OAuthException", code: 17 })
    );
    expect(err.kind).toBe("RATE_LIMIT");
  });

  it("classifies an unaccepted Custom Audience TOS as TOS_REQUIRED with a self-serve fix", () => {
    // Real-world shape (via Klaviyo/Reloadify support docs): code 100 with an
    // error_user_msg naming the Custom Audience Terms of Service explicitly.
    const err = classifyMetaError(
      400,
      body({
        message: "Invalid parameter",
        type: "OAuthException",
        code: 100,
        error_subcode: 1487390,
        error_user_title: "Custom Audience Terms of Service",
        error_user_msg: "You must accept the Custom Audience Terms of Service in order to create Custom Audiences.",
      })
    );
    expect(err.kind).toBe("TOS_REQUIRED");
    expect(err.humanMessage).toMatch(/customaudiences\/tos/i);
  });

  it("still classifies TOS errors phrased the other word order", () => {
    const err = classifyMetaError(
      400,
      body({ message: "Terms of Service for Custom Audience not accepted for this ad account.", code: 100 })
    );
    expect(err.kind).toBe("TOS_REQUIRED");
  });

  it("classifies a missing ads_management permission as PERMISSION", () => {
    const err = classifyMetaError(
      403,
      body({ message: "(#200) Permissions error", type: "OAuthException", code: 200 })
    );
    expect(err.kind).toBe("PERMISSION");
  });

  it("classifies a rejected payload as VALIDATION", () => {
    const err = classifyMetaError(
      400,
      body({ message: "Invalid parameter", error_user_msg: "Daily budget must be at least $1.00.", code: 100 })
    );
    expect(err.kind).toBe("VALIDATION");
    expect(err.humanMessage).toMatch(/daily budget/i);
  });

  it("falls back to UNKNOWN for an unrecognized error shape", () => {
    const err = classifyMetaError(500, body({ message: "Something went wrong.", code: 2 }));
    expect(err.kind).toBe("UNKNOWN");
  });

  it("does not misclassify a billing error as TOS_REQUIRED just because both mention 'terms'", () => {
    const err = classifyMetaError(
      400,
      body({ message: "Your card was declined per your bank's terms.", code: 100 })
    );
    expect(err.kind).toBe("BILLING");
  });
});
