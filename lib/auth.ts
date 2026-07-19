import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { Session, sessionSecret, verifySession } from "./session";

export type { Session };

/** Resolve the current session from the request cookie. Null = not logged in. */
export async function getSession(): Promise<Session | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const jar = await cookies();
  return verifySession(jar.get("adm")?.value, secret);
}

export function isAdmin(session: Session | null): boolean {
  return session?.role === "admin";
}

/** Prisma where-fragment limiting Client queries to what this session may see. */
export function clientScope(session: Session): { userId?: string } {
  return session.role === "admin" ? {} : { userId: session.userId };
}

/** Prisma where-fragment for Campaign queries (via the client relation). */
export function campaignScope(session: Session): object {
  return session.role === "admin" ? {} : { client: { userId: session.userId } };
}

/** True when this session may touch the given client. */
export async function canAccessClient(session: Session, clientId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { userId: true } });
  return client?.userId === session.userId;
}

/** True when this session may touch the given campaign. Legacy campaigns with no client are admin-only. */
export async function canAccessCampaign(session: Session, campaignId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { client: { select: { userId: true } } },
  });
  return campaign?.client?.userId === session.userId;
}

/**
 * Route-handler guard. Returns { session } on success or { response } to
 * return immediately. Usage:
 *   const auth = await requireSession();            // any logged-in role
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
