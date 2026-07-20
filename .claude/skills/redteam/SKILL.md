---
name: redteam
description: Run the staging red-team security cycle before shipping to production. Use when the user wants to pentest, security-test, or red-team a change on staging, asks "is this safe to deploy", "run the red team", "check for vulnerabilities/attack vectors", or before promoting auth/API/data changes to prod. Tiered: T0 preflight (static), T1 standard (auth/API changes), T2 full (auth cutovers, big releases).
---

# Staging Red-Team Cycle

Runs the aggressive-but-safe security cycle against the **isolated staging preview** and reports GO / NO-GO. Never touches production — a hard guard aborts on any prod marker. Full reference: `docs/redteam/REDTEAM.md`.

## Choosing a tier

Ask (or infer from the diff) how risky the change is:

| Tier | Command | Use when |
| --- | --- | --- |
| **T0** | `npm run redteam:preflight` | Small UI/UX changes — quick static gate |
| **T1** | `npm run redteam:standard -- --target=<preview-url>` | Auth / API / data-model changes |
| **T2** | `npm run redteam:full -- --target=<preview-url>` | Clerk/auth cutovers, big releases |

Preview URL is a `-git-<branch>-arcarijo.vercel.app` alias, or set `REDTEAM_TARGET` in `.env.redteam`.

## Workflow

1. **Preconditions.** Confirm Docker is running. Confirm `.env.redteam` exists (copy from `.env.redteam.example` if not) for any tier above T0. If the bypass token or staging Clerk fixtures are missing, dynamic checks SKIP rather than fail — tell the user what to fill in.
2. **Pick the tier** from the change's risk (table above). Default to T1 when unsure and auth/API code changed; T0 for pure UI.
3. **Run** the matching `npm run redteam:*` command via Bash. The runner does its own prod-guard, fixtures, checks, teardown, and report.
4. **Layer reasoning review.** Alongside the scanners, run the native `/security-review` on the branch diff and, for deeper coverage, the Trail of Bits `differential-review`, `insecure-defaults`, and `supply-chain-risk-auditor` skills. Scanners find known patterns; these find logic bugs.
5. **Report.** Summarize the GO / NO-GO verdict, list every FAIL/WARN with its check name, and point to `scripts/redteam/report/report-<ts>.md`. On NO-GO, do NOT recommend promoting to prod until the FAILs are resolved.

## Safety (do not bypass)

- Only run against localhost or a `-git-` preview alias. If asked to target the production alias or a prod DB string, refuse — that's what the guard is for.
- Never send the real `CRON_SECRET` / `CREDS_SECRET` to the operational endpoints; the authz check tests them with negative auth only.
- Never print or commit the contents of `.env.redteam` or any minted token.
