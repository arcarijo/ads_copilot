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

Merge = approval. **Note the honest limitation:** on a *private* repo, GitHub's free tier offers neither required reviewers nor required status checks — so CI cannot mechanically block a merge. What it does is post a loud, unmissable GO/NO-GO comment on every PR; the discipline rule is **never merge a PR whose `security` check isn't green**, and the sole human merger is the gate. To make the gate *mechanical* (free options):

- **Make the repo public** — no secrets live in git (enforced by `.gitignore` + `.env.example`), and public repos get free branch-protection/rulesets *and* unlimited Actions minutes. Then add a ruleset requiring the `risk` + `security` checks before merge to `main`.
- **or** keep it private on **GitHub Pro** (~$4/mo) for the same required-checks feature.
- **or** keep the discipline gate (current state) — fine while one trusted person merges.

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

## Phase 2 (active) — database migrations

- Schema change → `prisma migrate dev --name <x>` locally → commit the SQL.
- Vercel's build command (`npm run build`) runs `prisma migrate deploy && next build`, so every deploy — preview and production — applies any pending migration for that environment's DB automatically. No more manual `db push` after merge.
- One-off CLI access to an environment's DB (`migrate status`, `migrate resolve`, etc.) goes through `scripts/with-env.ts`, which loads a gitignored `.env.<env>.secrets` file and runs the command with that DB URL:
  - `npm run prisma:prod -- <subcommand>` — prod (`.env.production.secrets`)
  - `npm run prisma:preview -- <subcommand>` — preview/staging (`.env.preview.secrets`)
  Copy the matching `.example` file, paste the real pooler URL (session-mode, `:5432`) from the Vercel/Supabase dashboard.
- Use expand-contract (add nullable/new first, backfill, drop/rename later) for zero-downtime.

### Bootstrap gotcha: don't assume every environment is in the same state

When a migration's underlying schema change was **already applied by hand** to some environment before `migrate deploy` existed (e.g. an old `prisma db push`), that environment is *ahead* of migration history while others are *behind*. `prisma migrate deploy` will only succeed cleanly if each environment's `_prisma_migrations` table matches what's actually in its DB — and that has to be checked **per environment**, not assumed uniform:

- **2026-07-22, PR #29 (`chore/prisma-migrate-deploy`)**: `Client.lastAdminNotifyAt` had been pushed to staging by hand but never to production, so the baseline migration (introspected from staging's schema) included the column — correct for staging, wrong for prod.
- **2026-07-23, this fix**: a follow-up migration (`20260723143321_add_client_last_admin_notify_at`) was added specifically so production's `migrate deploy` would run the real `ALTER TABLE ADD COLUMN` it still needed. But Preview already had that column from the same earlier ad-hoc push staging did — so Preview's `migrate deploy` tried to add an already-existing column and **failed outright**, leaving Preview's migration history stuck in a `failed` state. Every subsequent build on Preview (and any PR branch whose preview environment shares that DB) kept failing at the `prisma migrate deploy` step, which is what made the app's generic `"Preflight check failed unexpectedly. Try again."` message (`app/api/campaigns/[id]/preflight/route.ts`) a *persistent* symptom in that environment rather than a one-off — the build never promoted, so the fix never shipped no matter how many times it was pushed.

**Root cause, one line:** a migration can be simultaneously correct for one environment and broken for another when environments have inconsistent pre-migration history. Always run `npm run prisma:<env> -- migrate status` against **every** environment before merging a schema-changing PR, and resolve (`migrate resolve --applied`/`--rolled-back`) any environment whose actual DB state doesn't match what the new migration expects — don't assume a fix verified against one environment's DB holds for the others.

**Do not reach for `prisma db push` against a real environment as a shortcut** (see `push-prod-schema.bat` in repo root — a leftover from before this phase landed). Any ad-hoc push against prod/staging re-creates this exact drift for the next migration.

See `docs/superpowers/specs/2026-07-20-deployment-pipeline-design.md` and the Phase 1 plan for details.
