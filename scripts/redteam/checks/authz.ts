// Tier 1: the high-value custom matrix — authorization, tenant isolation, IDOR,
// privilege escalation, and self-lockout guards. These are logic bugs no
// off-the-shelf scanner can find; every expectation is derived from the real
// code in lib/auth.ts, middleware.ts, and the route handlers.
//
// Operational endpoints (/api/cron, /api/admin/*) are tested with NEGATIVE auth
// only (missing / wrong bearer) — we never send the real secret, so nothing is
// triggered. All requests carry the Vercel bypass header to clear Deployment
// Protection while still exercising the APP's own auth.

import { call } from "../lib/http";
import type { Check, Finding, RunContext } from "../types";
import { worst } from "../types";

export const authzCheck: Check = async (ctx) => {
  const start = Date.now();
  const findings: Finding[] = [];
  const bypassSecret = ctx.bypassSecret;

  if (!ctx.memberToken || !ctx.adminToken || !ctx.memberClientId || !ctx.otherClientId) {
    return {
      name: "authz",
      status: "SKIP",
      findings: [{ status: "SKIP", title: "authz skipped — fixtures unavailable (see env setup)" }],
      durationMs: Date.now() - start,
    };
  }

  const expect = async (
    title: string,
    want: number | number[],
    req: Parameters<typeof call>[1],
  ): Promise<void> => {
    const res = await call(ctx.target, { ...req, bypassSecret });
    const wants = Array.isArray(want) ? want : [want];
    findings.push({
      status: wants.includes(res.status) ? "PASS" : "FAIL",
      title,
      detail: wants.includes(res.status) ? undefined : `expected ${wants.join("/")}, got ${res.status}`,
    });
  };

  const { memberToken, adminToken, adminUserId, memberClientId, otherClientId } = ctx as Required<RunContext>;

  // --- Unauthenticated: every API surface must reject with 401 ---
  await expect("Unauth GET /api/clients → 401", 401, { path: "/api/clients" });
  await expect("Unauth GET /api/clients/[id] → 401", 401, { path: `/api/clients/${otherClientId}` });
  await expect("Unauth GET /api/users → 401", 401, { path: "/api/users" });

  // --- Tenant isolation / IDOR: member vs another tenant's client (404, no existence leak) ---
  await expect("Member GET own client → 200", 200, { path: `/api/clients/${memberClientId}`, token: memberToken });
  await expect("Member GET other tenant's client → 404 (IDOR)", 404, {
    path: `/api/clients/${otherClientId}`, token: memberToken,
  });
  await expect("Member PATCH other tenant's client → 404 (IDOR)", 404, {
    method: "PATCH", path: `/api/clients/${otherClientId}`, token: memberToken, body: { name: "hacked" },
  });
  await expect("Member POST other tenant's research → 404 (SSRF/IDOR)", 404, {
    method: "POST", path: `/api/clients/${otherClientId}/research`, token: memberToken, body: {},
  });

  // --- Privilege escalation: member hitting admin-only surfaces (403) ---
  await expect("Member GET /api/users → 403", 403, { path: "/api/users", token: memberToken });
  await expect("Member POST /api/users invite → 403", 403, {
    method: "POST", path: "/api/users", token: memberToken, body: { email: "x@x.com" },
  });
  await expect("Member DELETE own client → 403 (delete is admin-only)", 403, {
    method: "DELETE", path: `/api/clients/${memberClientId}`, token: memberToken,
  });
  await expect("Member DELETE other client → 403", 403, {
    method: "DELETE", path: `/api/clients/${otherClientId}`, token: memberToken,
  });

  // --- Admin baseline + self-lockout guards ---
  await expect("Admin GET /api/users → 200", 200, { path: "/api/users", token: adminToken });
  await expect("Admin self-demote blocked → 400", 400, {
    method: "PATCH", path: `/api/users/${adminUserId}`, token: adminToken, body: { admin: false },
  });
  await expect("Admin self-revoke blocked → 400", 400, {
    method: "PATCH", path: `/api/users/${adminUserId}`, token: adminToken, body: { banned: true },
  });

  // --- Operational endpoints: public in middleware, must self-enforce (negative auth only) ---
  await expect("GET /api/cron no auth → 401", 401, { path: "/api/cron" });
  await expect("GET /api/cron wrong bearer → 401", 401, { path: "/api/cron", token: "not-the-secret" });
  await expect("POST /api/admin/rls no auth → 401", 401, { method: "POST", path: "/api/admin/rls", body: { action: "diagnose" } });
  await expect("POST /api/admin/rls wrong bearer → 401", 401, {
    method: "POST", path: "/api/admin/rls", token: "not-the-secret", body: { action: "diagnose" },
  });
  await expect("POST /api/admin/encrypt no auth → 401", 401, { method: "POST", path: "/api/admin/encrypt", body: {} });

  return { name: "authz", status: worst(findings), findings, durationMs: Date.now() - start };
};
