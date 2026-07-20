// Thin server-side wrapper over Clerk (Core 3 / @clerk/nextjs v7). Keeps the
// rest of the app decoupled from Clerk's surface: callers deal in a plain
// principal { userId, role } and a simple user list for the assignment UI.
import { auth, clerkClient } from "@clerk/nextjs/server";

/**
 * The current Clerk identity plus its role claim, or null when signed out.
 * `role` comes from the session token's `metadata` claim, which the Clerk
 * dashboard is configured to populate from the user's publicMetadata.
 */
export async function currentClerkPrincipal(): Promise<{ userId: string; role?: string } | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  const role = (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role;
  return { userId, role };
}

export interface ClerkUserRow {
  id: string;
  email: string;
  name: string;
  role: string | null;
  banned: boolean;
  lastSignInAt: number | null;
}

/** Admin-only: the Clerk users, shaped for the management UI. */
export async function listClerkUsers(): Promise<ClerkUserRow[]> {
  const client = await clerkClient();
  const res = await client.users.getUserList({ limit: 100, orderBy: "-created_at" });
  return res.data.map((u) => ({
    id: u.id,
    email: u.primaryEmailAddress?.emailAddress ?? "",
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "(no name)",
    role: ((u.publicMetadata as { role?: string } | null)?.role as string) ?? null,
    banned: Boolean(u.banned),
    lastSignInAt: u.lastSignInAt ?? null,
  }));
}

/** Admin-only: email an invitation to join. They become a Clerk user on accept. */
export async function inviteClerkUser(email: string): Promise<void> {
  const client = await clerkClient();
  await client.invitations.createInvitation({
    emailAddress: email,
    ignoreExisting: true,
  });
}

/** Admin-only: grant or remove the admin role via publicMetadata. */
export async function setClerkUserRole(userId: string, admin: boolean): Promise<void> {
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { role: admin ? "admin" : null },
  });
}

/** Admin-only: revoke (ban) or restore a user's ability to sign in. */
export async function setClerkUserBanned(userId: string, banned: boolean): Promise<void> {
  const client = await clerkClient();
  if (banned) await client.users.banUser(userId);
  else await client.users.unbanUser(userId);
}
