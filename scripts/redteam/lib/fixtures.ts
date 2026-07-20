// Test fixtures for the dynamic checks. Two things are needed to exercise the
// live authorization surface:
//   1. Real Clerk session tokens for a staging ADMIN and a staging MEMBER
//      (minted via the Clerk Backend API from the staging secret key).
//   2. Two Client rows: one the member OWNS and one they must NOT reach.
// Seeding/cleanup is done directly against the (guard-verified) staging DB so
// it doesn't depend on the app's own validation; the tests themselves go
// through the running app over HTTP.
//
// Required staging setup (one-time): create two users in the staging Clerk
// instance — one with publicMetadata.role = "admin", one plain member — and
// put their emails in REDTEAM_ADMIN_EMAIL / REDTEAM_MEMBER_EMAIL.

import { PrismaClient } from "@prisma/client";
import { FIXTURE_PREFIX } from "../config";

const CLERK_API = "https://api.clerk.com/v1";

export interface Fixtures {
  adminToken: string;
  adminUserId: string;
  memberToken: string;
  memberUserId: string;
  memberClientId: string;
  otherClientId: string;
  teardown: () => Promise<void>;
}

function clerkHeaders(): Record<string, string> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY (staging sk_test) is required for fixtures.");
  if (!key.startsWith("sk_test")) {
    throw new Error("Refusing to run: CLERK_SECRET_KEY is not a test (sk_test) key. Use the staging instance.");
  }
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function resolveUserId(email: string): Promise<string> {
  const res = await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}`, {
    headers: clerkHeaders(),
  });
  if (!res.ok) throw new Error(`Clerk user lookup failed (${res.status}). Check CLERK_SECRET_KEY.`);
  const users = (await res.json()) as { id: string }[];
  if (!users.length) {
    throw new Error(`No staging Clerk user for "${email}". Create it in the staging Clerk instance first.`);
  }
  return users[0].id;
}

/** Mint a short-lived default session token usable as `Authorization: Bearer`. */
async function mintSessionToken(userId: string): Promise<string> {
  const s = await fetch(`${CLERK_API}/sessions`, {
    method: "POST",
    headers: clerkHeaders(),
    body: JSON.stringify({ user_id: userId }),
  });
  if (!s.ok) throw new Error(`Clerk create-session failed (${s.status}) for ${userId}.`);
  const session = (await s.json()) as { id: string };
  const t = await fetch(`${CLERK_API}/sessions/${session.id}/tokens`, {
    method: "POST",
    headers: clerkHeaders(),
  });
  if (!t.ok) throw new Error(`Clerk session-token mint failed (${t.status}) for ${userId}.`);
  const { jwt } = (await t.json()) as { jwt: string };
  return jwt;
}

const DUMMY_META = {
  metaAdAccountId: "1234567890123456",
  metaPageId: "1098765432109876",
  metaAccessToken: "REDTEAM_FIXTURE_NOT_A_REAL_TOKEN",
};

export async function setupFixtures(): Promise<Fixtures> {
  const adminEmail = process.env.REDTEAM_ADMIN_EMAIL;
  const memberEmail = process.env.REDTEAM_MEMBER_EMAIL;
  if (!adminEmail || !memberEmail) {
    throw new Error("REDTEAM_ADMIN_EMAIL and REDTEAM_MEMBER_EMAIL must be set to staging Clerk user emails.");
  }

  const [adminUserId, memberUserId] = await Promise.all([
    resolveUserId(adminEmail),
    resolveUserId(memberEmail),
  ]);
  const [adminToken, memberToken] = await Promise.all([
    mintSessionToken(adminUserId),
    mintSessionToken(memberUserId),
  ]);

  const prisma = new PrismaClient();
  const stamp = Date.now();
  const memberClient = await prisma.client.create({
    data: { name: `${FIXTURE_PREFIX}member-${stamp}`, clerkUserId: memberUserId, ...DUMMY_META },
  });
  const otherClient = await prisma.client.create({
    // Owned by the admin fixture — the member must NOT be able to reach it.
    data: { name: `${FIXTURE_PREFIX}other-${stamp}`, clerkUserId: adminUserId, ...DUMMY_META },
  });

  const teardown = async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: FIXTURE_PREFIX } } });
    await prisma.$disconnect();
  };

  return {
    adminToken,
    adminUserId,
    memberToken,
    memberUserId,
    memberClientId: memberClient.id,
    otherClientId: otherClient.id,
    teardown,
  };
}
