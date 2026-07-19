# Clerk-Native Authentication Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom HMAC/passcode auth with Clerk as the identity source of truth (magic-link + Google + optional MFA), admin via Clerk role, tenant scoping re-keyed to Clerk user IDs — without weakening tenant isolation.

**Architecture:** Clerk owns login/session/tokens/reset/MFA. The app keeps `lib/auth.ts` scoping semantics unchanged, reading the Clerk user ID instead of a local `User.id`. The `User` table is retired; `Client.userId` becomes `Client.clerkUserId`.

**Tech Stack:** Next.js App Router 15.x, `@clerk/nextjs`, Prisma + Supabase Postgres, vitest.

## Global Constraints

- **Verify Clerk API against current docs** (via the `vercel:auth` skill / clerk.com/docs) before writing any code that calls the Clerk SDK — signatures below reflect knowledge that may be stale.
- Preserve exact signatures of `clientScope`, `campaignScope`, `canAccessClient`, `canAccessCampaign`, `requireSession` in `lib/auth.ts`.
- Do **not** rotate or touch `CREDS_SECRET` (still encrypts Meta/platform creds).
- The pre-commit secret guard (`.githooks/pre-commit`) must pass on every commit — never commit real Clerk secret keys; they live only in gitignored `.env.local`.
- Work on a feature branch; keep `main` deployable. Nothing in the old auth path is deleted until the Clerk path passes the isolation tests (Task 3) and provisioning (Phase 0) is done.
- Landing page (`app/login/page.tsx`) must be updated in the same effort per the CLAUDE.md standing rule.

---

## Phase 0 — Provisioning (EXTERNAL, user-performed — gates cutover)

Not a code task, but the app cannot authenticate until these are done. Sequence code so deletion of old auth (Task 8) happens only after this is complete.

- [ ] Create a Clerk application, or install **Clerk via the Vercel Marketplace** (`vercel:auth` skill) so `CLERK_*` env keys auto-inject.
- [ ] Enable **Email magic link/code** + **Google OAuth**; make **MFA** available.
- [ ] Set the admin user's `publicMetadata.role = "admin"` in the Clerk dashboard.
- [ ] Add a session-token custom claim exposing the role (so middleware/`auth()` can read it): in Clerk → Sessions → Customize session token, add `{ "metadata": "{{user.public_metadata}}" }` (verify exact syntax in Clerk docs).
- [ ] `vercel env pull` (or hand-add) `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` into `.env.local`.

---

## Task 1: Branch + install Clerk + env scaffolding

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `.env.example`

**Interfaces:**
- Produces: `@clerk/nextjs` available; documented env var names.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b clerk-auth-migration
```

- [ ] **Step 2: Install Clerk**

```bash
npm install @clerk/nextjs
```

- [ ] **Step 3: Update `.env.example`** — add the Clerk block; mark old vars removed. Add:

```dotenv
# --- Auth (Clerk — source of truth for identity) ------------------------------
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-in
# REMOVED (Clerk replaces these): ADMIN_PASSWORD, SESSION_SECRET
```

Keep `CREDS_SECRET` (still used for creds-at-rest + is not auth).

- [ ] **Step 4: Verify install + typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no usage yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Clerk dependency and env scaffolding"
```

---

## Task 2: Prisma — retire `User`, re-key `Client` to Clerk IDs

**Files:**
- Modify: `prisma/schema.prisma` (remove `User` model; rename `Client.userId` → `Client.clerkUserId`)

**Interfaces:**
- Produces: `Client.clerkUserId: String?` (indexed, nullable = unassigned/admin-only). No `User` model.

- [ ] **Step 1: Edit `schema.prisma`** — delete the entire `User` model. In `Client`, replace:

```prisma
  userId             String?
  user               User?   @relation(fields: [userId], references: [id], onDelete: SetNull)
```

with:

```prisma
  // Clerk user ID of the owning login. Null = unassigned (admin-only).
  clerkUserId        String?  @db.Text
  @@index([clerkUserId])
```

(Place the `@@index` with the other block attributes at the end of the model.) Remove the `clients Client[]` back-relation that lived on `User`.

- [ ] **Step 2: Regenerate the client + push schema**

```bash
npx prisma generate
npm run db:push
```

Expected: `db push` reports the dropped `User` table and renamed/added column. (Dev DB / test tenant only — no prod data.)

- [ ] **Step 3: Typecheck to surface every broken `userId` reference**

Run: `npx tsc --noEmit`
Expected: FAIL — compile errors everywhere `prisma.user` / `Client.userId` is used (auth.ts, users routes). These are the exact sites later tasks fix. Record the list.

- [ ] **Step 4: Commit the schema change**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): retire User model, re-key Client to clerkUserId"
```

---

## Task 3: Re-key `lib/auth.ts` onto Clerk (SECURITY CORE — TDD)

**Files:**
- Modify: `lib/auth.ts`
- Create: `lib/clerk.ts` (server helper)
- Test: `tests/auth-isolation.test.ts`

**Interfaces:**
- Consumes: Clerk `auth()` → `{ userId, sessionClaims }`.
- Produces (signatures UNCHANGED except source):
  - `getSession(): Promise<Session | null>` where `Session = { role: "admin" } | { role: "user"; userId: string }`
  - `clientScope(session): { clerkUserId?: string }` — **note key renamed to `clerkUserId`**
  - `campaignScope(session): object` → `{ client: { clerkUserId: session.userId } }` for users
  - `canAccessClient(session, clientId): Promise<boolean>`
  - `canAccessCampaign(session, campaignId): Promise<boolean>`
  - `requireSession(role?): Promise<{session} | {response}>`

- [ ] **Step 1: Write the failing isolation tests** — `tests/auth-isolation.test.ts`. Mock Clerk so we can inject identities, and mock Prisma lookups:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @clerk/nextjs/server's auth() — verify the real import path in Clerk docs.
const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));

// Mock the DB layer used by canAccess*.
vi.mock("../lib/db", () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../lib/db";
import { getSession, canAccessClient, canAccessCampaign, clientScope, campaignScope } from "../lib/auth";

beforeEach(() => vi.clearAllMocks());

describe("getSession", () => {
  it("returns admin when the role claim is admin", async () => {
    authMock.mockResolvedValue({ userId: "user_admin", sessionClaims: { metadata: { role: "admin" } } });
    expect(await getSession()).toEqual({ role: "admin" });
  });
  it("returns a scoped user otherwise", async () => {
    authMock.mockResolvedValue({ userId: "user_A", sessionClaims: { metadata: {} } });
    expect(await getSession()).toEqual({ role: "user", userId: "user_A" });
  });
  it("returns null when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null });
    expect(await getSession()).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("owner A CANNOT access owner B's client", async () => {
    (prisma.client.findUnique as any).mockResolvedValue({ clerkUserId: "user_B" });
    expect(await canAccessClient({ role: "user", userId: "user_A" }, "c1")).toBe(false);
  });
  it("owner A CAN access their own client", async () => {
    (prisma.client.findUnique as any).mockResolvedValue({ clerkUserId: "user_A" });
    expect(await canAccessClient({ role: "user", userId: "user_A" }, "c1")).toBe(true);
  });
  it("admin can access any client", async () => {
    expect(await canAccessClient({ role: "admin" }, "c1")).toBe(true);
  });
  it("owner A CANNOT access owner B's campaign", async () => {
    (prisma.campaign.findUnique as any).mockResolvedValue({ client: { clerkUserId: "user_B" } });
    expect(await canAccessCampaign({ role: "user", userId: "user_A" }, "camp1")).toBe(false);
  });
  it("clientScope restricts users to their own id and admins to all", () => {
    expect(clientScope({ role: "user", userId: "user_A" })).toEqual({ clerkUserId: "user_A" });
    expect(clientScope({ role: "admin" })).toEqual({});
    expect(campaignScope({ role: "user", userId: "user_A" })).toEqual({ client: { clerkUserId: "user_A" } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auth-isolation.test.ts`
Expected: FAIL (auth.ts still cookie/User-based; imports/types mismatch).

- [ ] **Step 3: Create `lib/clerk.ts`** — thin server wrapper (verify import paths in Clerk docs):

```ts
import { auth } from "@clerk/nextjs/server";

/** Current Clerk identity + role claim, or null. */
export async function currentClerkPrincipal(): Promise<{ userId: string; role?: string } | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  const role = (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role;
  return { userId, role };
}
```

- [ ] **Step 4: Rewrite `lib/auth.ts`** — replace cookie/session logic; keep signatures:

```ts
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { currentClerkPrincipal } from "./clerk";

export type Session = { role: "admin" } | { role: "user"; userId: string };

export async function getSession(): Promise<Session | null> {
  const p = await currentClerkPrincipal();
  if (!p) return null;
  return p.role === "admin" ? { role: "admin" } : { role: "user", userId: p.userId };
}

export function isAdmin(session: Session | null): boolean {
  return session?.role === "admin";
}

export function clientScope(session: Session): { clerkUserId?: string } {
  return session.role === "admin" ? {} : { clerkUserId: session.userId };
}

export function campaignScope(session: Session): object {
  return session.role === "admin" ? {} : { client: { clerkUserId: session.userId } };
}

export async function canAccessClient(session: Session, clientId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { clerkUserId: true } });
  return client?.clerkUserId === session.userId;
}

export async function canAccessCampaign(session: Session, campaignId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { client: { select: { clerkUserId: true } } },
  });
  return campaign?.client?.clerkUserId === session.userId;
}

export async function requireSession(
  role?: "admin"
): Promise<{ session: Session; response?: undefined } | { session?: undefined; response: NextResponse }> {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (role === "admin" && session.role !== "admin") {
    return { response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { session };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/auth-isolation.test.ts`
Expected: PASS (all isolation + role cases green).

- [ ] **Step 6: Update every `clientScope`/`campaignScope` consumer** — grep and fix the where-clause key (`userId` → `clerkUserId`) at call sites that spread these scopes into Prisma queries:

Run: `grep -rn "clientScope\|campaignScope" app lib --include=*.ts`
For each hit, confirm the spread still matches the Prisma `Client`/`Campaign` where-shape (now `clerkUserId`). Fix any direct `userId` filters.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `users` routes + deleted-auth consumers (fixed in Tasks 4–8).

- [ ] **Step 8: Commit**

```bash
git add lib/auth.ts lib/clerk.ts tests/auth-isolation.test.ts
git commit -m "feat(auth): re-key tenant scoping onto Clerk identity (isolation tested)"
```

---

## Task 4: Replace `middleware.ts` with `clerkMiddleware`

**Files:**
- Modify: `middleware.ts`

**Interfaces:**
- Consumes: Clerk `clerkMiddleware`, `createRouteMatcher` (verify in Clerk docs).
- Produces: public routes = sign-in + Clerk internals; everything else requires auth; `/users` + `/api/users` require the admin role claim.

- [ ] **Step 1: Rewrite `middleware.ts`** (verify Clerk API):

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/api/cron"]);
const isAdminOnly = createRouteMatcher(["/users(.*)", "/api/users(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  const { userId, sessionClaims } = await auth();
  if (!userId) return auth().redirectToSignIn();
  if (isAdminOnly(req)) {
    const role = (sessionClaims as { metadata?: { role?: string } })?.metadata?.role;
    if (role !== "admin") {
      return req.nextUrl.pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Admin only" }, { status: 403 })
        : NextResponse.redirect(new URL("/", req.url));
    }
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
```

Note: `/api/cron` stays public (Bearer-secured internally); `/api/admin/*` keep their own Bearer/admin checks and are covered by the authed default.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from middleware.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): swap custom edge gate for clerkMiddleware with admin role gate"
```

---

## Task 5: `<ClerkProvider>`, sign-in route, and authed nav

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/sign-in/[[...sign-in]]/page.tsx`
- Modify: the authed nav component (identify via grep; likely in `app/layout.tsx` or a `components/` nav)

**Interfaces:**
- Produces: app wrapped in `<ClerkProvider>`; `/sign-in` renders Clerk `<SignIn>`; nav shows `<UserButton>` (replaces the custom Sign out).

- [ ] **Step 1: Read the current files first**

Run: `cat app/layout.tsx`
Identify where the nav + logged-out suppression live.

- [ ] **Step 2: Wrap the app** — in `app/layout.tsx`, wrap the tree with `<ClerkProvider>` (import from `@clerk/nextjs`). Replace the custom logged-in/out branching with Clerk's `<SignedIn>`/`<SignedOut>` for nav visibility, preserving the existing full-bleed landing behavior for signed-out visitors.

- [ ] **Step 3: Create the sign-in page** — `app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }}>
      <SignIn />
    </main>
  );
}
```

- [ ] **Step 4: Replace the custom sign-out** — swap the existing "Sign out" control for `<UserButton />` (from `@clerk/nextjs`) inside the `<SignedIn>` region of the nav.

- [ ] **Step 5: Typecheck + local smoke (requires Phase 0 env keys)**

Run: `npx tsc --noEmit` then `npm run dev` and confirm `/sign-in` renders Clerk and an authed page shows the UserButton.
Expected: sign-in works with a real Clerk test account.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx "app/sign-in/[[...sign-in]]/page.tsx"
git commit -m "feat(auth): add ClerkProvider, sign-in route, and UserButton nav"
```

---

## Task 6: Rewrite `/users` as a Clerk-driven assignment surface

**Files:**
- Modify: `app/api/users/route.ts`, `app/api/users/[id]/route.ts`
- Modify: the `/users` page + its client component (identify via grep)
- Extend: `lib/clerk.ts` (add `listClerkUsers`)

**Interfaces:**
- Consumes: Clerk backend `clerkClient().users.getUserList()` (verify in docs).
- Produces:
  - `GET /api/users` (admin) → `[{ id, email, name }]` from Clerk
  - `POST /api/clients/[id]` assignment already exists via client update; add/confirm an endpoint to set `Client.clerkUserId` (admin-only)

- [ ] **Step 1: Add `listClerkUsers` to `lib/clerk.ts`**:

```ts
import { clerkClient } from "@clerk/nextjs/server";

export async function listClerkUsers(): Promise<{ id: string; email: string; name: string }[]> {
  const res = await (await clerkClient()).users.getUserList({ limit: 100 });
  return res.data.map((u) => ({
    id: u.id,
    email: u.primaryEmailAddress?.emailAddress ?? "",
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "(no name)",
  }));
}
```

- [ ] **Step 2: Rewrite `GET /api/users`** to return `listClerkUsers()` behind `requireSession("admin")`; delete all passcode create/update/delete logic from `app/api/users/route.ts` and `app/api/users/[id]/route.ts`. User lifecycle now lives in the Clerk dashboard.

- [ ] **Step 3: Rewrite the `/users` page** — read the current component, then change it from "create user + set passcode" to "assign Clerk users to Clients": show the Clerk user list and let admin set each `Client.clerkUserId` (via the existing client-update route or a small dedicated `PATCH`). Keep it admin-gated.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no more `prisma.user` references anywhere).

- [ ] **Step 5: Commit**

```bash
git add app/api/users lib/clerk.ts app/users
git commit -m "feat(users): replace passcode management with Clerk-user client assignment"
```

---

## Task 7: Update the landing page (standing rule)

**Files:**
- Modify: `app/login/page.tsx`

- [ ] **Step 1: Read the current landing page**

Run: `cat app/login/page.tsx`
Locate the login `<dialog>` + `/api/login` wiring.

- [ ] **Step 2: Replace the passcode dialog** — remove the `<dialog>` + `/api/login` call; point every "Sign in" CTA (nav, hero, closing CTA) to `/sign-in` (Clerk). Update the security section copy to state sign-in is handled by Clerk (magic-link/Google, optional MFA) — truthful, mechanism-not-secret, on the committed design system (branded `Icon` components, no emojis).

- [ ] **Step 3: Typecheck + visual check**

Run: `npx tsc --noEmit` then `npm run dev` → confirm landing renders and CTAs route to Clerk sign-in.

- [ ] **Step 4: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(landing): sign-in via Clerk; drop passcode box"
```

---

## Task 8: Delete dead auth code (only after Tasks 3–7 green + Phase 0 done)

**Files:**
- Delete: `lib/session.ts`, `app/api/login/route.ts`, `app/api/logout/route.ts`
- Modify: `lib/crypto.ts` (remove `passcodeHashV2`), `lib/rateLimit.ts` (remove login `rateLimited` usage if now unused — keep `aiRateLimited`/`clientIp`)

- [ ] **Step 1: Confirm no live imports remain**

Run: `grep -rn "lib/session\|passcodeHashV2\|/api/login\|/api/logout" app lib middleware.ts --include=*.ts --include=*.tsx`
Expected: no results (except comments/docs). Fix any stragglers first.

- [ ] **Step 2: Delete the files + prune `lib/crypto.ts`**

```bash
git rm lib/session.ts app/api/login/route.ts app/api/logout/route.ts
```
Then remove `passcodeHashV2` from `lib/crypto.ts` (keep `encryptSecret`, `decryptSecret`, `safeEqual`).

- [ ] **Step 3: Full typecheck + test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — `auth-isolation.test.ts` + `guardrails.test.ts` green, zero references to deleted modules.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(auth): remove custom session, passcode, and login/logout code"
```

---

## Task 9: Migrate test tenant + final verification

- [ ] **Step 1: Recreate the test owner in Clerk** — invite the Unity Studio owner (email), sign in once to create the Clerk user, copy their Clerk user ID.
- [ ] **Step 2: Assign the client** — via the new `/users` assignment UI (or a one-off `db:push` script), set Unity Studio's `Client.clerkUserId` to that ID.
- [ ] **Step 3: Manual cross-account isolation check** — with two Clerk accounts (one owner, one admin): owner sees only their client; owner gets 404 on another client's URL; admin sees all; MFA prompt works; sign-out invalidates the session.
- [ ] **Step 4: Confirm `.env.example` has no stale `ADMIN_PASSWORD`/`SESSION_SECRET` requirements** and `PREFLIGHT.md` line 6 (Clerk item) is checked.
- [ ] **Step 5: Open the PR**

```bash
git push -u origin clerk-auth-migration
gh pr create --title "Clerk-native authentication" --body "Implements docs/superpowers/specs/2026-07-19-clerk-auth-migration-design.md"
```

---

## Self-review notes
- **Spec coverage:** §1–§10 all mapped (architecture→Tasks 3–5; data model→Task 2; auth flow→Tasks 3–4; admin role→Tasks 3,4,6; provisioning→Phase 0; migration→Task 9; testing→Task 3 + Task 9; deletions→Task 8; landing rule→Task 7).
- **Placeholders:** none — Clerk API sites carry an explicit "verify in docs" constraint rather than a TODO.
- **Type consistency:** `Session`, `clerkUserId`, and the `lib/clerk.ts` helper names are used identically across Tasks 3, 4, 6.
