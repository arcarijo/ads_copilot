# Professional Deployment Pipeline — Design Spec

**Date:** 2026-07-20
**Status:** Decisions confirmed; spec for review before implementation.

## Executive Summary

An automated feature-to-production promotion pipeline that mimics professional-studio deployment on a **free, private-repo** stack (GitHub + Vercel + Supabase + Clerk). A feature is built on a branch, auto-tested and security-reviewed in CI, deployed to the isolated staging preview, risk-scored to pick a red-team depth, red-teamed on staging with a GO/NO-GO report posted to the PR, then promoted to production by the human **merging the PR** (the free equivalent of a required-reviewer gate). Production secrets never enter CI; database schema changes move to versioned Prisma migrations applied at deploy time.

## Confirmed Decisions

1. **Approval gate = merge to `main`.** Native required-reviewers isn't free for private repos (Enterprise-only), so CI makes the PR un-mergeable until green, and the human review + merge is the gate. Vercel deploys `main` → production.
2. **Adopt Prisma Migrate** (versioned, expand-contract) replacing manual `db:push`.
3. **Risk auto-scored by changed paths** → picks red-team tier T0/T1/T2.
4. **k6** for stress/load testing on staging.

## Secret & Key Hygiene (governing principles)

- **CI holds staging/test credentials only.** GitHub Actions secrets = staging bypass token, Clerk `sk_test`, staging `DATABASE_URL`. **Production DB/Clerk secrets never enter GitHub** — they live only in Vercel's Production env scope and are injected at deploy.
- **Migrations run where the secret already is.** `prisma migrate deploy` runs in **Vercel's build step** (Vercel injects the env-scoped DATABASE_URL): preview builds migrate staging, prod builds migrate prod. No prod DB URL in CI.
- **gitleaks in CI** is the free private-repo substitute for GitHub secret-scanning/push-protection (scans tree + history; blocks the PR on a hit).
- **No prod cloud keys in CI at all** — Vercel's Git integration deploys, so there's nothing to store (stronger than the OIDC baseline most teams aim for).
- Dependabot enabled; `.env*` gitignored with `.env.example` committed; secrets masked in logs; staging keys rotatable/disposable.

## Architecture / Flow

```
feature request → feat/* branch → TDD implement (+ k6 script if perf-sensitive)
  → push/PR → CI (GitHub Actions):
       job 1 gate:   tsc · vitest · build · gitleaks · semgrep
       job 2 stage:  wait for Vercel preview URL
       job 3 risk:   classify diff → tier T0/T1/T2
       job 4 redteam: npm run redteam --tier=<n> --target=<preview>
       job 5 report:  post test + GO/NO-GO summary as a PR comment; upload report artifact
  → human reviews PR + report → MERGE (the gate)
  → Vercel builds main: `prisma migrate deploy && next build` → PRODUCTION
  → post-deploy smoke test; Vercel Instant Rollback available
```

## Components to build

- `.github/workflows/ci.yml` — the gate + red-team + report pipeline on PRs to `main`.
- `.github/workflows/dependabot.yml` (config) + `.github/dependabot.yml`.
- `scripts/pipeline/classify-risk.ts` — reads `git diff --name-only` vs base, prints `tier=0|1|2` and reason (auth/**, middleware.ts, prisma/**, lib/auth*, lib/clerk* → 2; api/**, lib/** → 1; else → 0).
- `scripts/pipeline/post-report.ts` — formats CI + red-team results into a PR comment (via `gh`).
- `load/` — k6 scripts (`smoke.js`, `load.js`) hitting representative API routes on staging with the bypass header; thresholds on p95 latency + error rate.
- `scripts/redteam/checks/stress.ts` (optional) — wraps k6 as a red-team T2 check, or run standalone in CI.
- Prisma Migrate adoption: `prisma/migrations/0_init/` baseline from current schema; build command change to `prisma migrate deploy && next build`.
- `.github/PULL_REQUEST_TEMPLATE.md` — risk, test evidence, red-team verdict, rollback note.
- `docs/deploy/DEPLOYMENT.md` — the runbook (how a change flows, how to roll back, secret map).
- Optional pro touches: signed commits guidance, SLSA provenance attestation step.

## Prisma Migrate adoption (delicate — baselining an existing DB)

Because the DBs were built with `db:push`, there is no migration history. Adopting Migrate without data loss = **baselining**:

1. Create the baseline migration from the current schema: `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`.
2. Mark it already-applied on each existing DB so Prisma doesn't try to re-create tables:
   `prisma migrate resolve --applied 0_init` — run once against **staging**, once against **prod**.
   *(Prod is a destructive-class op for the agent → USER runs it via `!`.)*
3. From then on: `prisma migrate dev --name <change>` locally → commit the SQL → `migrate deploy` applies it in the pipeline. Schema changes use **expand-contract** (add nullable/new first, backfill, drop/rename in a later migration) for zero-downtime.

## Getting the Vercel preview URL in CI

Vercel builds the preview asynchronously. CI waits for the deployment (Vercel deployment status API / a wait-for-preview action) to obtain the URL, then targets the red-team + k6 runs at it with the protection-bypass header.

## Risk classifier rules (initial)

| Tier | Trigger paths |
|---|---|
| **T2** | `middleware.ts`, `lib/auth*`, `lib/clerk*`, `app/api/admin/**`, `app/api/users/**`, `prisma/**`, anything touching sessions/roles |
| **T1** | `app/api/**`, `lib/**`, data-model-adjacent code |
| **T0** | `app/**` UI, styles, copy, docs only |

Highest matched tier wins. Overridable by a `risk:high|med|low` PR label.

## User-action checklist (one-time)

1. Add GitHub Actions secrets (staging only): `VERCEL_AUTOMATION_BYPASS_SECRET`, staging `CLERK_SECRET_KEY` (sk_test), staging `DATABASE_URL`, `REDTEAM_ADMIN_EMAIL`, `REDTEAM_MEMBER_EMAIL`, and a Vercel token for preview-URL lookup.
2. Change the Vercel **Build Command** to `prisma migrate deploy && next build` (or via `vercel.ts`).
3. Run `prisma migrate resolve --applied 0_init` against **prod** (via `!`) after I generate the baseline.
4. Enable Dependabot in repo settings (or via committed config).
5. Confirm Vercel Production Branch = `main` and Preview deployments are on for PR branches.

## Out of scope (for now)

Canary/rolling releases (Vercel Pro-only), multi-region, blue-green infra, paid GitHub Enterprise gates, load testing beyond staging.

## Phasing

- **Phase 1 (safe, no prod impact):** CI workflow, risk classifier, PR template, k6 scripts, report poster, Dependabot, docs. Fully buildable now.
- **Phase 2 (prod-affecting, gated on your go-ahead):** Prisma Migrate baseline + build-command change + prod `migrate resolve`.
