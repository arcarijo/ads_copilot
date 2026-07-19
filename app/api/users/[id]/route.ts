import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession } from "@/lib/auth";

/**
 * Admin only: set which Clients the given Clerk user owns. Body: { clientIds }.
 * Identity/lifecycle (create, delete, passcode, MFA) is handled in Clerk — this
 * endpoint only manages the business relationship via Client.clerkUserId.
 * `id` is the Clerk user id.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  if (!Array.isArray(b.clientIds)) {
    return NextResponse.json({ error: "clientIds array required." }, { status: 422 });
  }
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
