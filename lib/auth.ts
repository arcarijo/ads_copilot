import { NextResponse } from "next/server";
import { prisma } from "./db";
import { currentClerkPrincipal } from "./clerk";

// Identity is owned by Clerk; authorization/tenancy stays here. A "user" is a
// Clerk user id; "admin" is a Clerk user whose role claim is "admin". Every
// scope/access check below is keyed on the Clerk user id via Client.clerkUserId.
export type Session = { role: "admin" } | { role: "user"; userId: string };

/** Resolve the current session from Clerk. Null = not signed in. */
export async function getSession(): Promise<Session | null> {
  const principal = await currentClerkPrincipal();
  if (!principal) return null;
  return principal.role === "admin" ? { role: "admin" } : { role: "user", userId: principal.userId };
}

export function isAdmin(session: Session | null): boolean {
  return session?.role === "admin";
}

/** Prisma where-fragment limiting Client queries to what this session may see. */
export function clientScope(session: Session): { clerkUserId?: string } {
  return session.role === "admin" ? {} : { clerkUserId: session.userId };
}

/** Prisma where-fragment for Campaign queries (via the client relation). */
export function campaignScope(session: Session): object {
  return session.role === "admin" ? {} : { client: { clerkUserId: session.userId } };
}

/** True when this session may touch the given client. */
export async function canAccessClient(session: Session, clientId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { clerkUserId: true } });
  return client?.clerkUserId === session.userId;
}

/** True when this session may touch the given campaign. Legacy campaigns with no client are admin-only. */
export async function canAccessCampaign(session: Session, campaignId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { client: { select: { clerkUserId: true } } },
  });
  return campaign?.client?.clerkUserId === session.userId;
}

/**
 * Route-handler guard. Returns { session } on success or { response } to
 * return immediately. Usage:
 *   const auth = await requireSession();            // any signed-in role
 *   const auth = await requireSession("admin");     // admin only
 */
export async function requireSession(
  role?: "admin"
): Promise<{ session: Session; response?: undefined } | { session?: undefined; response: NextResponse }> {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (role === "admin" && session.role !== "admin") {
    return { response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { session };
}
