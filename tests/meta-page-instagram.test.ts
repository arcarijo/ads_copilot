import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyCredentials, type MetaCreds } from "../lib/meta";

// verifyPage used to fetch `name` and `instagram_business_account` in one
// request. A token missing IG-specific permissions gets Graph API error #100
// ("nonexisting field") on that combined request, which failed the whole
// thing and mislabeled an Instagram-permission gap as a Facebook Page access
// failure (with misleading "reassign the Page" guidance). This pins the two
// fetches staying independent so each failure lands under the right item.
const creds: MetaCreds = { token: "t", accountId: "123", pageId: "999" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function stubFetch(byUrlSubstring: [string, unknown][]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const s = url.toString();
      for (const [key, body] of byUrlSubstring) {
        if (s.includes(key)) return jsonResponse(body);
      }
      throw new Error(`unexpected fetch to ${s}`);
    }),
  );
}

const baseline: [string, unknown][] = [
  ["act_123?", { name: "Acct", account_status: 1, funding_source_details: { display_string: "Visa" } }],
  ["customaudiencestos", { data: [{ id: "tos_1" }] }],
  ["campaigns", { success: true }],
];

afterEach(() => vi.unstubAllGlobals());

describe("verifyPage — Page access vs Instagram access", () => {
  it("still reports Page access ok when the IG field fetch fails with error #100", async () => {
    stubFetch([
      ["999?access_token=t&fields=instagram_business_account", { error: { message: "Tried accessing nonexisting field (instagram_business_account)", code: 100 } }],
      ["999?access_token=t&fields=name", { name: "My Page" }],
      ...baseline,
    ]);
    const result = await verifyCredentials(creds);
    const page = result.checks.find((c) => c.item === "Facebook Page access");
    const ig = result.checks.find((c) => c.item === "Instagram account access");
    expect(page?.ok).toBe(true);
    expect(ig?.ok).toBe(false);
    expect(ig?.detail).toMatch(/instagram/i);
  });

  it("reports Facebook Page access failure only when the name fetch itself fails", async () => {
    stubFetch([
      ["999?access_token=t&fields=name", { error: { message: "Unsupported get request.", code: 100 } }],
      ...baseline,
    ]);
    const result = await verifyCredentials(creds);
    const page = result.checks.find((c) => c.item === "Facebook Page access");
    expect(page?.ok).toBe(false);
  });

  it("reports Instagram access ok when a linked IG account is reachable", async () => {
    stubFetch([
      ["999?access_token=t&fields=instagram_business_account", { instagram_business_account: { id: "ig_1" } }],
      ["999?access_token=t&fields=name", { name: "My Page" }],
      ["fields=username", { username: "myclient" }],
      ...baseline,
    ]);
    const result = await verifyCredentials(creds);
    const ig = result.checks.find((c) => c.item === "Instagram account access");
    expect(ig?.ok).toBe(true);
  });
});
