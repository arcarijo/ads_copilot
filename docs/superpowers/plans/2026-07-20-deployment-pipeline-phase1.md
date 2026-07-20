# Deployment Pipeline — Phase 1 Implementation Plan & Handoff

> **RESUME HERE next session.** This is a live handoff. The "Progress" checklist is the source of truth for what's done vs pending. Work continues on branch **`feat/deploy-pipeline`** (off `main`).

**Goal:** Build the automated feature→CI→staging→risk-scored red-team→PR-report loop so a change gets auto-tested and red-teamed on the Vercel preview, with a GO/NO-GO comment on the PR, before the human merge-gate promotes it to prod.

**Architecture:** GitHub Actions on PRs to `main` runs static gates + a diff-based risk classifier that picks a red-team tier, runs the existing `scripts/redteam` harness (offline static pass in CI; full dynamic pass when staging secrets are present) + k6 load test against the Vercel preview, and posts a summary comment. Merge = approval (native required-reviewers isn't free on private repos). Full design: `docs/superpowers/specs/2026-07-20-deployment-pipeline-design.md`.

**Tech stack:** GitHub Actions, Node 24 + tsx, Docker scanners (already used by red-team), k6 (Docker `grafana/k6`), `gh` CLI for PR comments.

## Global Constraints (copy verbatim into every task)

- **Prod secrets NEVER enter CI.** GitHub Actions secrets are staging/test only (`sk_test`, staging DB, bypass token). Prod DB/Clerk keys live only in Vercel's Production env scope.
- **Migrations run in Vercel's build step**, not GitHub Actions (Phase 2).
- **Free/private-repo:** no paid GitHub environment gates; the human merge is the gate.
- Windows dev host; harness spawns npm/npx with `shell:true`, docker with `shell:false`.
- The red-team harness already skips dynamic checks (authz/dast) cleanly when no `--target`/creds — so CI is useful even before staging secrets are added.

## Progress (source of truth)

- [x] Design spec written & committed (`specs/2026-07-20-deployment-pipeline-design.md`)
- [x] 4 key decisions confirmed (merge-gate · Prisma Migrate · auto risk-scoring · k6)
- [x] Branch `feat/deploy-pipeline` created off `main`
- [x] **Task 1** — Risk classifier `scripts/pipeline/classify-risk.ts` (tested: T2 on auth diff, T0 on none)
- [x] **Task 2** — k6 load scripts `load/smoke.js`, `load/load.js`
- [x] **Task 3** — PR template `.github/PULL_REQUEST_TEMPLATE.md`
- [x] **Task 4** — Dependabot `.github/dependabot.yml`
- [x] **Task 5** — CI workflow `.github/workflows/ci.yml` — **no-secrets path complete** (risk + static red-team + verdict comment). Dynamic red-team + k6 are commented TODO blocks at the bottom (secret-gated).
- [~] **Task 6** — PR report poster: a BASIC verdict comment is inlined in ci.yml. Richer `scripts/pipeline/post-report.ts` (parse report JSON + k6 summary into a table) is PENDING.
- [x] **Task 7** — Runbook `docs/deploy/DEPLOYMENT.md`
- [ ] **Task 8** — Verify: open a throwaway PR, watch CI, confirm the comment posts (DO THIS FIRST next session)
- [ ] **User setup** — add GH Actions secrets (staging only) + enable Dependabot in settings
- [ ] **Task 5b** — finish the secret-gated jobs: wait-for-Vercel-preview → dynamic red-team + k6 (uncomment/complete the TODO blocks in ci.yml)

**tsc clean over app + redteam + pipeline scripts.** Nothing committed to prod; all Phase 1 work is on `feat/deploy-pipeline` (no PR opened yet).

## Resume instructions

```
git checkout feat/deploy-pipeline && git pull
# read this file's Progress list, pick the first unchecked task
npx tsx scripts/pipeline/classify-risk.ts --base=origin/main   # sanity-check classifier
```

Then continue the unchecked tasks below in order. Each is self-contained. After Task 8, hand the user the secret-setup checklist and (separately) proceed to **Phase 2** (Prisma Migrate baseline — prod-affecting, needs the user).

## What's been BUILT this session (files already on the branch after the first commit)

See the commit(s) on `feat/deploy-pipeline`. Anything checked above is done; anything unchecked is not started. If a file exists but its task is unchecked, treat it as a partial draft and finish it.

## Task details

### Task 1 — Risk classifier
`scripts/pipeline/classify-risk.ts`. Reads `git diff --name-only <base>...HEAD`, matches paths, prints highest tier + reason, and writes `tier=`/`reason=` to `$GITHUB_OUTPUT` when set. Rules: T2 = `middleware.ts`, `lib/auth*`, `lib/clerk*`, `lib/crypto*`, `app/api/admin/**`, `app/api/users/**`, `prisma/**`; T1 = `app/api/**`, `lib/**`; else T0. `risk:high|med|low` PR label overrides.

### Task 2 — k6 scripts
`load/smoke.js` (1 VU, quick), `load/load.js` (ramp to N VUs). Hit representative GET routes on the preview with the `x-vercel-protection-bypass` header from env. Thresholds: `http_req_failed<1%`, `http_req_duration p(95)<800ms`. Run via `docker run --rm -e ... grafana/k6 run - <load.js`.

### Task 3 — PR template
`.github/PULL_REQUEST_TEMPLATE.md`: summary · risk tier (auto/override) · test evidence · red-team verdict · rollback note · secret-hygiene checkbox.

### Task 4 — Dependabot
`.github/dependabot.yml`: npm ecosystem, weekly, grouped minor/patch.

### Task 5 — CI workflow
`.github/workflows/ci.yml` on `pull_request` to `main`. Jobs: (a) **gate** — checkout, setup-node, `npm ci`, `tsc`, `vitest`, `npm run redteam:preflight`; (b) **risk** — run classifier, expose tier output; (c) **redteam** — needs preview URL + secrets; if secrets present run `redteam` at the classified tier against the preview, else run offline static pass; (d) **loadtest** — k6 at T1+; (e) **report** — post comment. Mark secret-gated steps with `if: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET != '' }}`. Getting the preview URL: use a wait-for-Vercel-preview step keyed on the commit SHA (document the chosen action).

### Task 6 — Report poster
`scripts/pipeline/post-report.ts`: reads the latest `scripts/redteam/report/report-*.json` + k6 summary, formats a markdown table, upserts a PR comment via `gh pr comment` (or the GH API with `GITHUB_TOKEN`).

### Task 7 — Runbook
`docs/deploy/DEPLOYMENT.md`: the full flow, the secret map (what lives in GH vs Vercel), how to read the CI comment, how to roll back (Vercel Instant Rollback / `isRollbackCandidate`), and the Phase 2 migration runbook stub.

### Task 8 — Verify
Open a small throwaway PR (e.g., a comment change), confirm CI runs, the classifier picks T0, and the report comment posts. Then close it.

## Phase 2 (next, prod-affecting — separate session, needs user)

Prisma Migrate baseline: generate `prisma/migrations/0_init` from current schema; user runs `prisma migrate resolve --applied 0_init` against staging then **prod** (via `!`); change Vercel Build Command to `prisma migrate deploy && next build`. Detailed in the design spec.

## Key facts to not re-derive

- Prod is LIVE at the `main` production deployment (merge `0109623`, `dpl_5x84ao1dpdw9KAQKqjj3CRAeEXQ9`).
- Vercel projectId `prj_aK01Z4DU5ygCbmX1VO51l3wPu71Q`, teamId `team_Isf6Z3rbumOXmfwnrbYjNSvB`, project slug `claude_projects`, repo `arcarijo/ads_copilot`.
- Staging Supabase ref `lprydieusipocvsikkqb`; prod ref `ovdpfhexljhotzhrfhrg` (never in CI).
- Red-team entry points: `npm run redteam:preflight|standard|full [-- --target=<preview>]`; harness at `scripts/redteam/`.
- Preview alias pattern: `claudeprojects-git-<branch>-arcarijo.vercel.app` (contains `-git-`, which the red-team guard requires).
