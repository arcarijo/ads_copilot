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

/** Admin-only: the Clerk users, shaped for the client-assignment UI. */
export async function listClerkUsers(): Promise<{ id: string; email: string; name: string }[]> {
  const client = await clerkClient();
  const res = await client.users.getUserList({ limit: 100 });
  return res.data.map((u) => ({
    id: u.id,
    email: u.primaryEmailAddress?.emailAddress ?? "",
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "(no name)",
  }));
}
