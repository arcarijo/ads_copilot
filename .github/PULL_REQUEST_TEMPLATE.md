<!-- The CI pipeline auto-tests + risk-scores + red-teams this on the preview.
     Merging to main is the production-approval gate. -->

## Summary
<!-- What changed and why, in 1-3 sentences. -->

## Risk tier
<!-- CI auto-classifies by changed paths. Override by adding a risk:high|med|low label. -->
- [ ] Auto (let the classifier decide)
- [ ] Override → tier: `______` (why: ______)

## Verification
- [ ] `tsc` + `vitest` pass locally
- [ ] Red-team run reviewed (CI comment / `npm run redteam:*`) — verdict: **GO / NO-GO**
- [ ] Load test acceptable (T1+) — p95 / error rate: ______

## Secrets & data
- [ ] No secrets added to the repo or CI (staging/test creds only; prod stays in Vercel)
- [ ] Schema change? If yes, migration is expand-contract and reversible (Phase 2)

## Rollback
<!-- If this misbehaves in prod: Vercel Instant Rollback to the prior READY deployment. -->
- [ ] Confirmed the prior prod deployment is a rollback candidate
