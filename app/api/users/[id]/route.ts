import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { currentClerkPrincipal, setClerkUserRole, setClerkUserBanned } from "@/lib/clerk";

/**
 * Admin only. Manages a Clerk user (`id` = Clerk user id) along three axes,
 * dispatched by which key is present in the body:
 *   { admin: boolean }      -> grant/remove the admin role
 *   { banned: boolean }     -> revoke/restore sign-in (revoke also releases
 *                              their businesses)
 *   { clientIds: string[] } -> set which Clients this user owns
 * Sign-in/MFA/reset stay with Clerk; hard-delete stays in the Clerk dashboard.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  // Role change — guard against an admin removing their own admin.
  if (typeof b.admin === "boolean") {
    const acting = await currentClerkPrincipal();
    if (!b.admin && acting?.userId === id) {
      return NextResponse.json({ error: "You can't remove your own admin role." }, { status: 400 });
    }
    await setClerkUserRole(id, b.admin);
    await log("UI", `User ${id} role set to ${b.admin ? "admin" : "member"}.`);
    return NextResponse.json({ ok: true });
  }

  // Revoke/restore — guard against an admin locking themselves out.
  if (typeof b.banned === "boolean") {
    const acting = await currentClerkPrincipal();
    if (b.banned && acting?.userId === id) {
      return NextResponse.json({ error: "You can't revoke your own access." }, { status: 400 });
    }
    await setClerkUserBanned(id, b.banned);
    if (b.banned) {
      // Revoking access also releases the businesses they owned.
      await prisma.client.updateMany({ where: { clerkUserId: id }, data: { clerkUserId: null } });
    }
    await log("UI", `User ${id} ${b.banned ? "access revoked" : "access restored"}.`);
    return NextResponse.json({ ok: true });
  }

  // Business assignment.
  if (Array.isArray(b.clientIds)) {
    const clientIds = b.clientIds.filter((c: unknown) => typeof c === "string");
    await prisma.$transaction([
      // Release clients this user no longer owns...
      prisma.client.updateMany({ where: { clerkUserId: id, id: { notIn: clientIds } }, data: { clerkUserId: null } }),
      // ...and claim the selected ones (moves them off any prior owner).
      prisma.client.updateMany({ where: { id: { in: clientIds } }, data: { clerkUserId: id } }),
    ]);
    await log("UI", `Client assignments updated for user ${id}.`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
}
