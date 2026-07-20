# Staging Red-Team Cycle — Design Spec

**Date:** 2026-07-20
**Status:** Approved direction (branch points confirmed via Q&A); ready for implementation plan.

## Executive Summary

A tiered, on-demand security-testing cycle the developer can run against the **isolated staging environment** before promoting any change to production. It layers deterministic static analysis, dynamic scanning of a running instance, and a custom business-logic harness (authz / tenant-isolation / IDOR / SSRF) that generic tools cannot produce. The overriding invariant is that **production data is never touched**: prod is a physically separate Supabase project, and a hard guard aborts the run if it ever sees the prod ref or a prod domain.

## Confirmed Decisions

- **Dynamic scan target:** the Vercel **preview URL** for the current feature branch, reached with a Deployment-Protection **bypass token** (`x-vercel-protection-bypass`). Preview writes to the **staging** Supabase project (`lprydieusipocvsikkqb`), so prod is untouched.
- **Tooling:** Semgrep (SAST) + gitleaks (secrets) + OWASP ZAP (DAST) + Nuclei (template DAST) + Trail of Bits code-audit skills. Native `/security-review` remains the reasoning baseline. **Deliberately excluded:** offensive kill-chain bundles (offensive-claude, secskills, Kali/sqlmap/hydra MCPs) — wrong tool for self-testing and highest supply-chain risk per Snyk ToxicSkills (13% of security skills had critical flaws).
- **Runtime:** all four scanners run **containerized via Docker** (Docker 29 present) — no fragile Windows-native installs, matches CI.

## Tiers

| Tier | Trigger | Steps | Target | Est. |
|---|---|---|---|---|
| **T0 Preflight** | Every change incl. UI | `/security-review` on diff · `tsc --noEmit` · `vitest run` · `npm audit` | code only | seconds |
| **T1 Standard** | Auth / API / data-model changes | T0 + Semgrep + gitleaks + custom **authz/tenant/IDOR** harness | preview URL | 2–4 min |
| **T2 Full red team** | Clerk/auth cutovers, big releases | T1 + ZAP active scan + Nuclei + SSRF fuzz of `/research` → **go/no-go report** | preview URL | 10–20 min |

## Safety Architecture (invariant: prod untouched)

1. **Prod guard (`guard.ts`):** aborts loudly if the resolved target URL or any DB string contains the prod ref `ovdpfhexljhotzhrfhrg` or a known prod domain. Runs first, every tier.
2. **Allowlist target:** the run only proceeds against `localhost`, a `*-arcarijo.vercel.app` preview alias, or an explicitly-passed staging host — never the prod alias.
3. **Bypass token from env only:** `VERCEL_AUTOMATION_BYPASS_SECRET` is read from the environment, never hardcoded or logged.
4. **Self-cleaning fixtures:** destructive/authz tests create their own synthetic tenants (prefixed `zzz-redteam-`) and delete them after; they never mutate seed/real rows.
5. **Secret hygiene:** no secret value is ever echoed to stdout, the report, or git.

## Components

- `scripts/redteam/config.ts` — tiers, prod ref, allowed hosts, docker image tags.
- `scripts/redteam/guard.ts` — `assertNotProd(target, dbUrl)`.
- `scripts/redteam/fixtures.ts` — mints two Clerk **staging** sessions (admin + member) via the Clerk Backend API test key, seeds `zzz-redteam-` tenants, returns bearer tokens; tears down after.
- `scripts/redteam/checks/static.ts` — tsc, vitest, npm audit.
- `scripts/redteam/checks/secrets.ts` — gitleaks (docker) on the working tree + git history.
- `scripts/redteam/checks/sast.ts` — Semgrep (docker) with `p/owasp-top-ten`, `p/nextjs`, `p/typescript`.
- `scripts/redteam/checks/authz.ts` — the high-value custom matrix (below).
- `scripts/redteam/checks/ssrf.ts` — feeds internal/metadata URLs to `/api/clients/[id]/research` and asserts they're refused.
- `scripts/redteam/checks/dast.ts` — ZAP baseline+active and Nuclei (docker) against the preview URL with the bypass header.
- `scripts/redteam/run.ts` — orchestrator: `--tier=0|1|2 --target=<url>`; runs guard → steps → writes report.
- `scripts/redteam/report/` — timestamped markdown + JSON go/no-go summary.
- `docs/redteam/REDTEAM.md` — how to run, tier guidance, safety model, required env.
- `.claude/skills/redteam/SKILL.md` — callable wrapper so the cycle can be invoked conversationally.

## Custom authz/tenant matrix (what off-the-shelf tools miss)

Derived from the real code (`lib/auth.ts`, `middleware.ts`):

- **Cross-tenant IDOR:** member A requesting member B's client via `GET/PATCH/POST /api/clients/[id]` and `.../research` must get **404** (code returns 404, not 403 — verify it doesn't leak existence).
- **Privilege escalation:** member hitting admin-only surfaces (`/api/users*`, `DELETE /api/clients/[id]`, admin meta-field writes in PATCH) must get **403**.
- **Self-lockout guards:** admin cannot self-demote or self-revoke (expect 400).
- **Unauthenticated:** every `/api/*` returns **401** with no session.
- **Public operational endpoints:** `/api/cron`, `/api/admin/encrypt`, `/api/admin/rls` are `isPublic` in middleware — assert their **own Bearer auth** rejects a missing/wrong token (these are unguarded by the edge, so this is the critical check).
- **Input boundary:** replay the `lib/sanitize.ts` malicious-URL / injection payloads through the live create/update endpoints.

## Required user action (one-time)

Generate a **Protection Bypass for Automation** secret in Vercel → Project Settings → Deployment Protection, and expose it locally as `VERCEL_AUTOMATION_BYPASS_SECRET`. Without it, dynamic scans hit Vercel's auth wall.

## Out of scope

Offensive tooling, prod scanning, load/DoS testing, social-engineering, anything that leaves the staging boundary.
