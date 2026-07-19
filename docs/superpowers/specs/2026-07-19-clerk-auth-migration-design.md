# Design: Clerk-native Authentication Migration

**Date:** 2026-07-19
**Status:** Approved (design)
**Author:** ads_copilot team
**Topic:** Replace the custom HMAC/passcode auth with Clerk as the identity source of truth.

---

## 1. Overview

Today the app authenticates two principals with custom code:
- **Master admin** — the `ADMIN_PASSWORD` env var (not a DB row), gated in `middleware.ts`.
- **Owner users** — the `User` model (`passcodeHash`), with tenant isolation keyed on `User.id` via `Client.userId`.

We are replacing this with **Clerk as the source of truth for identity**. Clerk owns login (email magic-link/code + Google OAuth, optional MFA), sessions, tokens, expiry, password reset, and login rate-limiting. The application keeps owning the **business relationship** (which owner may see which `Client`) and all tenant-scoping logic — re-keyed from `User.id` to the Clerk user ID.

This is a **security-critical, higher-risk migration**: it retires the `User` table, re-keys every tenant foreign key, and rewrites the auth path. It is also a net *reduction* in custom security-sensitive code.

## 2. Goals / Non-goals

**Goals**
- Clerk handles all user + admin authentication (magic-link + Google; MFA available).
- Admin is a Clerk user with `publicMetadata.role = "admin"`.
- Preserve tenant isolation semantics exactly; re-key to Clerk user IDs.
- Delete custom session/passcode/login code and the login rate-limiter.
- Prove isolation with automated tests before cutover.

**Non-goals (YAGNI)**
- Clerk Organizations / multi-seat teams (one-owner-to-many-clients is enough today).
- Migrating production user data (only one test owner exists — recreate, don't migrate).
- Changing anything downstream of `getSession()` (guardrails, optimizer, Meta bridge, RLS).

## 3. Architecture & component changes

### Source-of-truth flip
- **Identity:** Clerk (login, session, tokens, MFA, reset, login throttling).
- **Authorization/tenancy:** our DB + `lib/auth.ts` (unchanged shape), reading the Clerk user ID.
- **Secrets at rest:** `lib/crypto.ts` AES-256-GCM for Meta/platform creds stays; only the *passcode-hash* helpers are removed.

### Delete
- `lib/session.ts` (custom HMAC session).
- `passcodeHashV2` in `lib/crypto.ts` (keep `encryptSecret`/`decryptSecret`/`safeEqual`).
- `app/api/login/route.ts`, `app/api/logout/route.ts`.
- Login limiter (`rateLimited` for login) — keep `aiRateLimited`/`clientIp` in `lib/rateLimit.ts`.
- Passcode login UI (the `<dialog>` in `app/login/page.tsx`).
- `User` model + `passcodeHash`.

### Add
- `@clerk/nextjs` dependency.
- `clerkMiddleware` in `middleware.ts` with route matchers; role gate for admin surfaces.
- `<ClerkProvider>` in `app/layout.tsx`; `<UserButton>`/sign-out in the authed nav.
- Clerk `<SignIn>` route (`app/sign-in/[[...sign-in]]/page.tsx`) + landing-page CTA wired to it.
- `lib/clerk.ts` (thin server helper: current user id + role, list users for assignment).

### Change
- `lib/auth.ts` — `getSession()` returns `{ role: "admin" } | { role: "user"; userId }` derived from Clerk's `auth()` (`sessionClaims.metadata.role` for admin, else `userId`). **`clientScope`, `campaignScope`, `canAccessClient`, `canAccessCampaign`, `requireSession` keep their exact signatures and behavior.**
- `prisma/schema.prisma` — drop `User`; rename `Client.userId` → `Client.clerkUserId` (`String?`, nullable = unassigned/admin-only, indexed). Remove the `User` relation.
- `/users` admin page → **assignment page**: lists Clerk users (Clerk backend API) and sets `Client.clerkUserId`. Admin-role gated.
- `app/api/users/*` → assignment endpoints (admin-only), no passcode logic.
- `app/api/me/route.ts` → returns Clerk-derived identity/role.
- `.env.example` — add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, sign-in URLs; mark `ADMIN_PASSWORD`/`SESSION_SECRET` as removed (keep `CREDS_SECRET`).
- Landing page (`app/login/page.tsx`) — per the standing rule, update to reflect Clerk-secured sign-in (no passcode box; "Sign in" → Clerk).

## 4. Auth flow

1. Unauthenticated request → `clerkMiddleware` redirects to `/sign-in` (Clerk `<SignIn>`; magic-link/Google).
2. On success, Clerk sets its session; user returns to the app.
3. Server route/page calls Clerk `auth()` → `userId` + `sessionClaims`. `getSession()` maps this to our `Session` type: admin if `metadata.role === "admin"`, else `{ role: "user", userId }`.
4. Authorization unchanged: admin sees all; owners scoped to `Client.clerkUserId === userId`; `/users` + admin APIs require the admin role (checked in middleware **and** server-side in `requireSession("admin")`).

## 5. Data model migration

- Only one test owner (Unity Studio) exists → **recreate**: invite that owner in Clerk, capture their Clerk user ID, set `Client.clerkUserId`.
- Prisma: `db push` to drop `User` and rename the column. No production data at risk.
- RLS unchanged (Prisma-as-owner bypasses; app-layer scoping does the real work, now keyed on Clerk IDs).

## 6. Provisioning (requires the user — cannot be done by the agent)

1. Create a Clerk application (or install the **Clerk integration via the Vercel Marketplace**, which auto-injects `CLERK_*` env keys — preferred; covered by `vercel:auth`).
2. Enable **Email (magic link/code)** + **Google OAuth**; make **MFA** available.
3. Set the admin user's `publicMetadata.role = "admin"` (Clerk dashboard).
4. Pull env keys locally (`vercel env pull` / `.env.local`).

The agent will write all code; the app will not authenticate until these steps are done. This dependency is called out in the implementation plan as an explicit external step.

## 7. Testing strategy (gate for cutover)

- **Tenant isolation (automated, vitest):** an owner (Clerk id A) must get 403/404 on another owner's (id B) Client and Campaign across `canAccessClient`/`canAccessCampaign` and the scoped list queries. Mock Clerk `auth()` to inject identities.
- **Role gating (automated):** non-admin blocked from `/users` + admin APIs; admin allowed.
- **Regression:** existing `guardrails.test.ts` stays green.
- **Manual cross-account check:** two real Clerk accounts, confirm no cross-tenant visibility, MFA prompt works, sign-out invalidates.
- Old auth remains functional in a branch until the new path passes all of the above.

## 8. Rollout & rollback

- Implement on a feature branch; keep `main` deployable.
- Rollback = revert the branch (Clerk env keys are inert if unused; `CREDS_SECRET` untouched, so encrypted Meta creds remain readable throughout).

## 9. Risks

- **Cross-tenant leakage if scoping isn't re-keyed everywhere** → mitigated by isolation tests + grep audit of every `userId` usage.
- **Middleware misconfig exposing routes** → explicit public/protected matcher review; server-side `requireSession` remains a second gate (defense in depth).
- **Losing the admin path** (no more `ADMIN_PASSWORD`) → verify the admin role claim is set before deleting the old gate.
- **Provisioning blocker** → user must complete §6; plan sequences code so nothing is deleted until Clerk is live.

## 10. Checklist items this closes

Session/JWT expiry correctness, login rate-limiting, password-reset safety, optional MFA, and "login flows that look complete but skip a step" — all offloaded to Clerk (see `PREFLIGHT.md`).
