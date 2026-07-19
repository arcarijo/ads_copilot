import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, canAccessCampaign } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      snapshots: { orderBy: { date: "desc" }, take: 30 },
      logs: { orderBy: { createdAt: "desc" }, take: 50 },
      alerts: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ campaign });
}
