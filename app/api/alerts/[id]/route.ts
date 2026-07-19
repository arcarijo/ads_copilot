import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

/** Acknowledge (dismiss) an alert. Users may only dismiss their own clients' alerts. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (auth.session.role === "user") {
    const alert = await prisma.alert.findUnique({
      where: { id },
      select: { campaign: { select: { client: { select: { userId: true } } } } },
    });
    if (alert?.campaign?.client?.userId !== auth.session.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  await prisma.alert.update({ where: { id }, data: { acknowledged: true } });
  return NextResponse.json({ ok: true });
}
