# Deployment Runbook

How a change goes from idea to production, and how to recover if it misbehaves.

## The flow

```
feat/* branch → open PR to main
   → CI (.github/workflows/ci.yml):
        risk      : classify the diff → tier T0/T1/T2
        security  : npm ci · red-team static pass (tsc·vitest·npm audit·gitleaks·semgrep·ssrf)
                    → posts a GO/NO-GO comment on the PR + uploads the report
        [next]    : dynamic red-team (authz/DAST) + k6, against the Vercel preview
   → review the PR + the CI comment
   → MERGE to main   ← this is the production-approval gate
   → Vercel builds main → production (atomic; old prod stays live until READY)
```

Merge = approval. Native required-reviewers isn't free on private repos, so CI makes the PR un-mergeable-until-green and the human merge is the gate.

## Risk tiers

The classifier (`scripts/pipeline/classify-risk.ts`) picks depth by changed paths:

| Tier | Triggered by | Red-team depth |
| --- | --- | --- |
| **T2** | `middleware.ts`, `lib/auth*`, `lib/clerk*`, `lib/crypto*`, `app/api/admin/**`, `app/api/users/**`, `prisma/**` | full (static + authz + DAST) |
| **T1** | `app/api/**`, `lib/**` | static + authz |
| **T0** | UI / content / docs only | static |

Override with a `risk:high|med|low` label on the PR.

## Secret map (who holds what)

| Secret | Lives in | Never in |
| --- | --- | --- |
| Prod DB URL, Clerk `sk_live`, `pk_live` | Vercel **Production** env scope | GitHub, git, CI |
| Staging DB URL, Clerk `sk_test`, bypass token, red-team fixture emails | GitHub Actions **secrets** (staging only) + `.env.redteam` (local, gitignored) | git |
| Publishable keys (`pk_*`) | public by design (`NEXT_PUBLIC_*`) | — |

**Rule: production secrets never enter CI.** Migrations run in Vercel's build step (Phase 2), where the prod DB URL already is.

## Enabling the dynamic red-team + k6 in CI (one-time)

The CI **static** pass (risk-score + SAST + secrets + tests + verdict comment) runs on every PR with **no setup**. The **dynamic** jobs (authz/DAST against the live preview + k6) stay dormant until you opt in:

1. Add these **repository variables** (Settings → Secrets and variables → Actions → *Variables*):
   - `ENABLE_DYNAMIC_REDTEAM = true` — the master switch that activates the dynamic jobs.
   - `VERCEL_PROJECT_ID = prj_aK01Z4DU5ygCbmX1VO51l3wPu71Q`
   - `VERCEL_TEAM_ID = team_Isf6Z3rbumOXmfwnrbYjNSvB`
2. Add these **repository secrets** (all **staging/test only** — never prod):
   - `VERCEL_TOKEN` — a Vercel access token (read-only is fine) so CI can resolve the preview URL.
   - `VERCEL_AUTOMATION_BYPASS_SECRET` — Deployment-Protection bypass token.
   - `STAGING_CLERK_SECRET_KEY` — the staging Clerk `sk_test…` key.
   - `STAGING_DATABASE_URL` — the **staging** Supabase URL (must contain ref `lprydieusipocvsikkqb`; the red-team guard refuses anything else).
   - `REDTEAM_ADMIN_EMAIL`, `REDTEAM_MEMBER_EMAIL` — two users in the **staging** Clerk instance (one with `publicMetadata.role = "admin"`, one plain member).
3. Ensure the **staging DB has the current schema** (it's missing the campaign v2 columns): run `db:push` against staging once. Otherwise preview builds error on the new columns.

With those set, any PR at tier ≥ 1 waits for its Vercel preview, runs the full dynamic red-team + k6 against it, and never touches prod. Unset `ENABLE_DYNAMIC_REDTEAM` to pause it again.

## Rolling back

Vercel deploys are atomic and every prior production deploy is a rollback candidate:

1. Vercel dashboard → project → Deployments → pick the last-good production deployment → **Instant Rollback**. Propagates globally in seconds.
2. Or CLI: `vercel rollback <deployment-url>`.
3. Then fix forward on a branch through the normal PR flow.

The current live prod is the deployment for the latest `main` merge commit (look for `target: production`, `state: READY`).

## Running the gate locally

```
npm run redteam:preflight                       # T0 static (fast)
npm run redteam:standard -- --target=<preview>  # T1 (needs .env.redteam)
npm run redteam:full     -- --target=<preview>  # T2 aggressive
npx tsx scripts/pipeline/classify-risk.ts --base=origin/main   # what tier is my change?
```

## Phase 2 (pending) — database migrations

Not yet active. When adopted:
- Schema change → `prisma migrate dev --name <x>` locally → commit the SQL.
- Vercel build command becomes `prisma migrate deploy && next build` (preview migrates staging, prod migrates prod).
- Baseline (one-time): generate `prisma/migrations/0_init`, then `prisma migrate resolve --applied 0_init` on staging and prod.
- Use expand-contract (add nullable/new first, backfill, drop/rename later) for zero-downtime.

See `docs/superpowers/specs/2026-07-20-deployment-pipeline-design.md` and the Phase 1 plan for details.
