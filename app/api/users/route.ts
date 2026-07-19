import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { sha256Hex } from "@/lib/session";
import { passcodeHashV2 } from "@/lib/crypto";

/** Admin only (also enforced in middleware): list users with their clients. */
export async function GET() {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      clients: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ users });
}

/** Admin only: create a user with a passcode. */
export async function POST(req: NextRequest) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  const passcode = String(b.passcode ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 422 });
  if (passcode.length < 8) {
    return NextResponse.json({ error: "Passcode must be at least 8 characters." }, { status: 422 });
  }
  if (passcode === process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "That passcode is unavailable." }, { status: 422 });
  }
  // Peppered v2 hash when CREDS_SECRET is configured; legacy sha256 otherwise.
  const passcodeHash = passcodeHashV2(passcode) ?? (await sha256Hex(passcode));
  // Clash check must cover both hash generations of the same passcode.
  const existing = await prisma.user.findFirst({
    where: { passcodeHash: { in: [passcodeHash, await sha256Hex(passcode)] } },
  });
  if (existing) return NextResponse.json({ error: "That passcode is already in use — pick another." }, { status: 422 });
  const user = await prisma.user.create({
    data: { name, email: b.email?.trim() || null, passcodeHash },
  });
  await log("UI", `User "${name}" created.`, { detail: { userId: user.id } });
  return NextResponse.json({ userId: user.id });
}
