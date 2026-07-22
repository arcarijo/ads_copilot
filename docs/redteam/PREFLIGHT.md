# Security Readiness Preflight Checklist

The security readiness bible for this repo. Automated scanners (`npm run redteam:*`) catch known-shape vulnerabilities — hardcoded secrets, missing authz, SSRF, OWASP-pattern injection. They do **not** catch judgment calls: a new endpoint that forgets rate limiting, a regex with no upper bound, a feature that quietly changes what data leaves the system. This checklist is the manual layer that closes that gap, and it runs on every change alongside (not instead of) the automated cycle in `docs/redteam/REDTEAM.md`.

Run this checklist before opening a PR for review, and re-confirm it before merge if the diff changed materially.

## 1. Risk tier assessment (do this first)

Every change gets a tier. The tier decides which `npm run redteam:*` command is required and how much of this checklist is mandatory vs. advisory.

| Tier | Trigger | Required automated cycle | This checklist |
| --- | --- | --- | --- |
| **T0** | Pure UI/UX, copy, styling — no new data flow, no new endpoint, no new external call | `npm run redteam:preflight` | Section 2 only (spot-check) |
| **T1** | New/changed API route, new DB read/write, new auth-gated surface, new input parsed from the client | `npm run redteam:standard -- --target=<preview>` | Sections 2–4 in full |
| **T2** | New external/third-party integration (API keys, webhooks, outbound network calls), auth/session changes, anything touching money, PII, or admin privilege | `npm run redteam:full -- --target=<preview>` | All sections, including 5 |

**When unsure, round up a tier.** Under-tiering is the more expensive mistake — it's how the resolve-folder rate-limiting gap (below) almost shipped.

## 2. Code-level risk factors (manual review — scanners miss these)

Walk the diff against each row. Check it off or write one line explaining why it doesn't apply.

| Risk factor | What to check | Reference |
| --- | --- | --- |
| **Unrestricted resource consumption** | Does this new/changed endpoint call a shared, quota-limited, or metered resource (third-party API key, AI inference, email/SMS send, DB-heavy query)? If yes, it needs a rate limiter (`aiRateLimited` or equivalent) matching the pattern already used on sibling routes — not a bespoke one-off. | [OWASP API4:2023](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/) |
| **Regex / input-length bounding** | Any new regex on user input: does every capture group have an upper bound (`{min,max}`, not `{min,}`)? Any nested/overlapping quantifiers (`(a+)+`, `(a\|a)+`)? | [OWASP ReDoS](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS), CWE-1333 |
| **Authorization / tenant isolation** | Does every new route check `requireSession()` and scope every DB query to the caller's tenant/client? Cross-tenant reads return 404 (not 403, to avoid existence leaks) unless there's a documented reason otherwise. | covered by `authz` check at T1+ |
| **SSRF / outbound URL construction** | Any new code that builds a URL from user input and fetches it? Host must be fixed/allowlisted, or run through `isSafePublicUrl`. | covered by `ssrf` check at T2 |
| **Prompt injection (AI-backed features)** | Any new user-controlled value reaching an LLM prompt? It must go through a strict allowlist/enum (like `toCampaignIntent()`), never raw free text concatenated into a system/developer-authored prompt segment. | — |
| **Information disclosure in errors** | Do new `catch` blocks log the real error server-side and return a generic message to the client? No stack traces, DB errors, or internal paths in API responses. | — |
| **Secrets handling** | Any new env var added? Is it server-only (never `NEXT_PUBLIC_*` unless it's meant to be public), documented in `.env.example` with scope/restriction guidance, and excluded from client bundles? | covered by `secrets` check at T1+ |
| **Dangerous DOM/eval sinks** | `dangerouslySetInnerHTML`, `eval(`, `new Function(`, `innerHTML`, `document.write` — any new use must be justified inline with a comment explaining why it's safe. | — |

## 3. Compliance considerations

| Area | Check | Notes |
| --- | --- | --- |
| **PII / data minimization** | Does this change store, log, or transmit new personal data (email, name, IP, payment info)? If yes, confirm it's necessary, encrypted at rest where applicable, and not written to logs. | See `lib/rateLimit.ts` — deliberately "zero PII persisted" by design; match that bar. |
| **Third-party ToS / data sharing** | New external API integration: does it send user/tenant data off-platform? Confirm the provider's terms allow the use case (e.g., Google Drive API key scoped read-only, Meta API scopes match what's requested). | Applies to any new platform registry entry. |
| **Third-party quota/cost exposure** | Is there a spend cap or usage alert on the provider side for any new metered API key, or does an attacker-triggered spike translate directly to an unbounded bill? | Pair with the resource-consumption row in Section 2. |
| **Retention** | Does this change introduce new persisted data that needs a retention/deletion story (tied to tenant offboarding)? | — |

## 4. Pre-merge verification

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — all relevant test files pass, including any new tests for the risk factors above
- [ ] Automated cycle at the assessed tier returned **GO** (`scripts/redteam/report/report-<ts>.md`)
- [ ] Every unchecked/non-applicable row in Sections 2–3 has a one-line reason, not a silent skip

## 5. T2-only: deeper review

- [ ] Run native `/security-review` on the full branch diff
- [ ] Run the Trail of Bits `differential-review`, `insecure-defaults`, and `supply-chain-risk-auditor` skills
- [ ] Manually re-read every new file end-to-end (not just grep for dangerous patterns) — grep only proves absence of known bad strings, not presence of sound logic
- [ ] Validate any judgment-call finding against current external guidance (OWASP, CWE, provider docs) before deciding it's low-risk — don't rely on training-data knowledge alone for anything provider/API-specific, since terms and best practices change

## Changelog

- **2026-07-22** — Initial version. Seeded from the campaign-intent-coaching PR audit: added the resource-consumption and regex-bounding rows after finding `/api/campaigns/resolve-folder` shipped without rate limiting on a shared Google Drive API key, and three Drive-id regexes had unbounded capture groups.
