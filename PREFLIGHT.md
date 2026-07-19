# Production Preflight Checklist — ads_copilot

> Living checklist for production-readiness. Audited **2026-07-19** against the live codebase.
> Legend: `[x]` handled · `[~]` partial · `[ ]` gap · `[-]` not relevant (reason given).
> Re-audit before any major launch or after auth/data-model changes.

---

## Why this checklist exists — how vibe-coded apps actually fail

Research (2026) on breaches of AI-built apps shows the failures are **predictable and concentrated**. AI codegen produces *functional* code fast, not *secure* code — it skips the steps attackers look for. The top failure modes, and **where we stand on each**:

| # | Vibe-coded failure mode (industry) | Our status |
|---|---|---|
| 1 | **Broken access control / RLS disabled** — DB or endpoint readable by anyone. >60% of findings; cause of the Moltbook 1.5M-token leak (Jan 2026). | ✅ RLS enabled on all tables + app-layer tenant scoping (`lib/auth.ts`) + edge gate (`middleware.ts`). |
| 2 | **Exposed API keys** — bundled in client env, committed to git, or in client-side fetch headers. Typical damage $5k–$50k. | ✅ All secrets server-only; AES-256-GCM at rest; `.gitignore` + pre-commit secret guard; no keys in client bundles. |
| 3 | **Client-side-only auth / no expiry** — JWTs without expiry, sessions that survive logout. | ✅ Server-verified HMAC sessions with signed 30-day `exp`; `/api/logout`; rotate-secret invalidates all. |
| 4 | **IDOR** — `/api/thing/:id` returns anyone's record. | ✅ Per-object `canAccessClient/Campaign`; 404-on-deny. |
| 5 | **Over-verbose API responses** — endpoints return whole rows (emails, hashes, tokens). | ✅ Explicit Prisma `select`; token columns never returned (`hasAccessToken` flags only). |
| 6 | **Injection (XSS/SQLi/log)** — 86% of AI samples failed XSS defense. | ✅ Prisma parameterized; React auto-escape; no `dangerouslySetInnerHTML`; email LLM-text HTML-escaped; SSRF guard. |
| 7 | **Hallucinated dependencies** — 19.7% of AI code references non-existent packages (supply-chain risk). | `[ ]` No automated dependency scanning yet (see Testing section). |
| 8 | **Missing login rate limiting.** | ✅ Per-IP + global login caps (`lib/rateLimit.ts`) — though in-memory/best-effort. |
| 9 | **Misconfig** — debug in prod, CORS `*`, missing security headers, stack traces leaked. | ✅ Security headers + HSTS (`next.config.mjs`); errors returned as structured messages, no stack traces. |

**Sources:** [The Hacker News — 2,000 exposed vibe-coded apps](https://thehackernews.com/2026/05/what-2000-exposed-vibe-coded-apps.html) · [OX Security — 62% ship with vulnerabilities](https://www.ox.security/blog/vibe-coding-security/) · [Wiz — risks in 20% of vibe-coded apps](https://www.wiz.io/blog/common-security-risks-in-vibe-coded-apps) · [Cybersecify — API key leak patterns](https://cybersecify.com/blog/ai-api-key-leaks-vibe-coded-saas-pentest/) · [CSA — AI-generated CVE surge](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-generated-code-vulnerability-surge-2026/)

**Bottom line:** we are strong exactly where most vibe-coded apps get breached (access control, secrets, IDOR, injection). Our real gaps are operational maturity — testing/CI, dependency scanning, resilience — not the classic breach vectors.

---

## 🔐 Security & access
- [x] **Input sanitization & injection prevention** — Prisma parameterized, zod validation, SSRF guard (`lib/urlSafety.ts`), anti-hallucination wall, email HTML-escaping, React auto-escape.
- [x] **Authentication, authorization, roles, permissions** — edge gate + server scoping; admin/user roles; per-object access checks.
- [x] **Session management & token expiry** — v2 HMAC cookie w/ signed 30-day exp; constant-time compare; logout; rotate-to-invalidate.
- [x] **Secrets management** — AES-256-GCM at rest; peppered passcodes; gitignore + pre-commit guard; Vercel sensitive env. ⚠️ Fix stale `schema.prisma` "plaintext" comment; `CREDS_SECRET`-missing falls back to plaintext.
- [x] **HTTPS / TLS / cert rotation** — Vercel-managed auto-TLS + rotation; HSTS 2yr includeSubDomains. `[-]` nothing to operate manually.
- [~] **Rate limiting & abuse prevention** — login + per-user AI throttle + durable research caps + capacity monitor; **in-memory/per-instance** (move to durable store for hard guarantees).
- [x] **Multi-tenancy & data isolation** — app-layer scoping + Postgres RLS (defense-in-depth).

## 🗄️ Data & compliance
- [ ] **Dependency scanning & vulnerability patching** — no Dependabot / `npm audit` in CI. **High-value quick win.**
- [~] **PII handling, retention, deletion** — customer-list PII SHA-256 hashed pre-Meta, raw never stored; but emails plaintext; **no retention/TTL** (Log/Snapshot/ResearchRun/UsageEvent grow unbounded); deletion is manual admin action.
- [~] **Regulatory compliance** — HIPAA `[-]` not relevant (no PHI). GDPR partial: PII minimized + deletion cascades, but no documented retention policy, DPA, consent records, or DSAR process.
- [~] **Audit trails & tamper-evident logging** — `Log`/`Alert`/`UsageEvent` exist but rows are mutable (not append-only / hash-chained).

## 🧪 Testing & quality
- [ ] **Unit / integration / e2e tests** — only `tests/guardrails.test.ts` exists.
- [ ] **Regression tests** — none beyond the above.
- [ ] **Load & stress testing** — none.
- [ ] **Chaos / resilience testing** — none.
- [ ] **Test coverage thresholds in CI** — no CI (`.github/workflows` absent), no coverage gate.
- [~] **Code review process & standards** — solo repo; no PR review / CODEOWNERS / branch protection. TS strict + strong conventions. **Enable branch protection now that it's on GitHub.**

## ⚙️ Reliability & resilience
- [x] **Error handling & graceful degradation** — structured alerts + ERROR status instead of crashes; AI JSON-repair; email mock fallback; capacity trip-wires.
- [ ] **Retry with backoff & idempotency** — `lib/ai.ts` has no timeout/retry; `launchToMeta` has no idempotency key / lock / rollback → partial-launch orphans possible. (Research fetch has a 10s timeout.)
- [ ] **Circuit breakers & fallback** — none around Meta/Cloudflare; `MAX_ACTIONS_PER_CYCLE` caps blast radius only.
- [~] **Concurrency & race prevention** — launch status check is read-then-update (non-atomic double-launch race); `@@unique` protects some paths; no row lock / optimistic version on Campaign transitions.
- [-] **Caching strategy & invalidation** — mostly N/A; per-request DB-backed, ground-truth intentionally read fresh each cycle.

## 🚨 Ops, DR, docs, accessibility
- [ ] **RTO / RPO** — undocumented; implicitly "Supabase backups + Vercel redeploy."
- [ ] **Disaster recovery plan** — no runbook (restore steps, secret re-provision; **losing `CREDS_SECRET` makes encrypted creds unrecoverable**).
- [~] **Accessibility** — landing page a11y-aware (impeccable) + native `<dialog>` login; app UI (dashboard/wizard) not formally audited.
- [~] **Architecture diagrams** — prose docs exist (`META_PIPELINE_ARCHITECTURE.md`, `PRODUCT.md`); no visual diagram.
- [ ] **ADRs** — decisions in code comments/docs/memory; no formal ADR log.

---

## Priority remediation queue
1. **CI + dependency scanning + branch protection** — GitHub Actions (typecheck + vitest + `npm audit`) + Dependabot. Closes the hallucinated-dependency vector and unblocks coverage/PR review.
2. **Launch idempotency + rollback** (`launchToMeta`) — atomic READY→LAUNCHING guard + reconcile partial Meta entities. Protects real ad spend.
3. **Timeout + retry/backoff + breaker** on `lib/ai.ts` external calls.
4. **DR one-pager + RTO/RPO** — Supabase backup cadence, restore steps, `CREDS_SECRET` safekeeping.
5. **Retention/TTL sweep** for logs/snapshots (also advances GDPR retention).
6. **Auth hardening: migrate user login to Clerk** (in progress) — offloads session/JWT/rate-limit/password-reset correctness to a specialist, closing the "login flows that look complete but skip steps" failure mode.
