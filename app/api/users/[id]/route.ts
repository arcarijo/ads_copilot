import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { sha256Hex } from "@/lib/session";
import { passcodeHashV2 } from "@/lib/crypto";

/** Admin only: edit a user (name, email, passcode) and reassign clients. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const data: { name?: string; email?: string | null; passcodeHash?: string } = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if ("email" in b) data.email = b.email?.trim() || null;
  if (typeof b.passcode === "string" && b.passcode.trim()) {
    const passcode = b.passcode.trim();
    if (passcode.length < 8) {
      return NextResponse.json({ error: "Passcode must be at least 8 characters." }, { status: 422 });
    }
    if (passcode === process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "That passcode is unavailable." }, { status: 422 });
    }
    const passcodeHash = passcodeHashV2(passcode) ?? (await sha256Hex(passcode));
    const clash = await prisma.user.findFirst({
      where: { passcodeHash: { in: [passcodeHash, await sha256Hex(passcode)] } },
    });
    if (clash && clash.id !== id) {
      return NextResponse.json({ error: "That passcode is already in use — pick another." }, { status: 422 });
    }
    data.passcodeHash = passcodeHash;
  }

  await prisma.user.update({ where: { id }, data });

  // Client assignment: an explicit array of client ids this user should own.
  if (Array.isArray(b.clientIds)) {
    const clientIds = b.clientIds.filter((c: unknown) => typeof c === "string");
    await prisma.$transaction([
      prisma.client.updateMany({ where: { userId: id, id: { notIn: clientIds } }, data: { userId: null } }),
      prisma.client.updateMany({ where: { id: { in: clientIds } }, data: { userId: id } }),
    ]);
  }

  await log("UI", `User ${id} updated${data.passcodeHash ? " (passcode changed)" : ""}.`);
  return NextResponse.json({ ok: true });
}

/** Admin only: delete a user. Their clients become unassigned (admin-only). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const { id } = await params;
  await prisma.user.delete({ where: { id } });
  await log("UI", `User ${id} deleted; their clients are now unassigned.`);
  return NextResponse.json({ ok: true });
}
