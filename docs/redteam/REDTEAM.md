# Staging Red-Team Cycle

An on-demand, tiered security-testing cycle that runs against the **isolated staging preview** before any change ships to production. It layers deterministic static analysis, dynamic scanning of the running app, and a custom business-logic harness (authorization / tenant-isolation / IDOR / SSRF) that generic scanners can't produce.

**Invariant: production is never touched.** Prod is a separate Supabase project; a guard (`guard.ts`) aborts the run if it ever sees a prod marker or a non-allowlisted host.

## Tiers

| Command | Tier | When | Checks |
| --- | --- | --- | --- |
| `npm run redteam:preflight` | **T0** | Every change, incl. UI | `static` (tsc · vitest · npm audit) |
| `npm run redteam:standard` | **T1** | Auth / API / data-model changes | T0 + `secrets` + `sast` + `authz` |
| `npm run redteam:full` | **T2** | Clerk/auth cutovers, big releases | T1 + `ssrf` + `dast` (ZAP active + Nuclei) |

Add the target for dynamic tiers: `npm run redteam:standard -- --target=https://<preview>.vercel.app` (or set `REDTEAM_TARGET` in `.env.redteam`).

Pair every run with Claude's reasoning reviewers for the logic bugs scanners miss:
`/security-review` (native) and the Trail of Bits `differential-review`, `insecure-defaults`, and `supply-chain-risk-auditor` skills.

## One-time setup

1. **Docker** — the four scanners run containerized (images already pulled): gitleaks, semgrep, nuclei, ZAP.
2. **Vercel bypass token** — Project Settings → Deployment Protection → *Protection Bypass for Automation*. Copy the secret to `VERCEL_AUTOMATION_BYPASS_SECRET`. Without it, dynamic scans hit Vercel's auth wall.
3. **Staging Clerk fixtures** — in the **staging** Clerk instance create two users: one with `publicMetadata.role = "admin"`, one plain member. Put their emails in `REDTEAM_ADMIN_EMAIL` / `REDTEAM_MEMBER_EMAIL`.
4. **Secrets file** — `cp .env.redteam.example .env.redteam` and fill it in. It is gitignored. `CLERK_SECRET_KEY` must be `sk_test` and `DATABASE_URL` must be the staging project (`lprydieusipocvsikkqb`) — the harness refuses anything else.

## What each check does

- **static** — `tsc --noEmit`, `vitest run`, `npm audit` (high/critical fail the gate).
- **secrets** — gitleaks over the working tree **and git history**.
- **sast** — Semgrep with `p/owasp-top-ten`, `p/nextjs`, `p/typescript`, `p/secrets`.
- **authz** — the high-value custom matrix, derived from `lib/auth.ts` + `middleware.ts`:
  - unauthenticated → 401 on every API surface;
  - cross-tenant IDOR (member vs another tenant's client) → 404 (no existence leak);
  - privilege escalation (member → admin-only routes, delete) → 403;
  - self-lockout guards (admin can't self-demote / self-revoke) → 400;
  - operational endpoints (`/api/cron`, `/api/admin/rls`, `/api/admin/encrypt`) reject missing/wrong bearer — **negative auth only, the real secret is never sent**.
- **ssrf** — validates `isSafePublicUrl` rejects a payload set (localhost, private ranges, cloud metadata, `file:`/`gopher:`, and integer-encoded loopback), and still allows legitimate public URLs.
- **dast** — ZAP passive baseline + active attack scan and Nuclei against the preview, injecting the bypass header. Set `REDTEAM_ZAP_FULL=0` to skip the long active scan.

## Output

Each run writes `scripts/redteam/report/report-<ts>.md` + `.json` and prints a terminal summary ending in **GO / NO-GO**. Exit codes: `0` GO, `1` NO-GO (a check FAILed), `2` prod-guard abort, `3` runner error. All report artifacts are gitignored.

## Safety model (why prod is safe)

1. Prod is a **different Supabase project** — unreachable unless a prod string is supplied.
2. `guard.ts` runs first: aborts on any `PROD_MARKERS` substring in the target or `DATABASE_URL`, and requires an allowlisted host (localhost, a `-git-` Vercel preview alias, or `REDTEAM_ALLOW_HOSTS`).
3. `DATABASE_URL` must reference the staging ref or the run aborts.
4. Fixtures create only `zzz-redteam-`-prefixed tenants and delete them on teardown.
5. Secrets are read from `.env.redteam` and never logged or committed.
