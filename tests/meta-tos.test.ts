import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyCredentials, type MetaCreds } from "../lib/meta";

// verifyAdCreationPermission's validate_only campaign-create probe never
// exercises the Custom Audience TOS gate (that gate lives on the
// customaudiences endpoint, not campaigns), so a client who hadn't accepted
// it looked fully "ready" until launch. This pins the proactive GET-based
// check added to close that gap.
const creds: MetaCreds = { token: "t", accountId: "123", pageId: "999" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function stubFetch(byUrlSubstring: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const s = url.toString();
      for (const [key, body] of Object.entries(byUrlSubstring)) {
        if (s.includes(key)) return jsonResponse(body);
      }
      throw new Error(`unexpected fetch to ${s}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("verifyCredentials — Custom Audience TOS check", () => {
  it("reports accepted when the customaudiencestos edge returns a populated data array", async () => {
    stubFetch({
      "act_123?": { name: "Acct", account_status: 1, funding_source_details: { display_string: "Visa" } },
      "999?": { name: "Page" },
      "customaudiencestos": { data: [{ id: "tos_1" }] },
      "campaigns": { success: true },
    });
    const result = await verifyCredentials(creds);
    const tos = result.checks.find((c) => c.item === "Custom Audience Terms of Service");
    expect(tos?.ok).toBe(true);
  });

  it("reports NOT accepted when the customaudiencestos edge returns an empty data array", async () => {
    stubFetch({
      "act_123?": { name: "Acct", account_status: 1, funding_source_details: { display_string: "Visa" } },
      "999?": { name: "Page" },
      "customaudiencestos": { data: [] },
      "campaigns": { success: true },
    });
    const result = await verifyCredentials(creds);
    const tos = result.checks.find((c) => c.item === "Custom Audience Terms of Service");
    expect(tos?.ok).toBe(false);
    expect(tos?.detail).toMatch(/customaudiences\/tos/i);
    expect(result.ready).toBe(false);
  });
});
