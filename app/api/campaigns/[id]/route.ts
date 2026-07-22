import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession, canAccessCampaign } from "@/lib/auth";
import { cleanText } from "@/lib/sanitize";

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

/**
 * Edit the per-campaign directive and/or A/B notes after launch. These steer
 * the daily optimizer; owners can refresh them any time. Sanitized; the
 * directive timestamp is bumped so staleness tracking stays accurate.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const b = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof b.directive === "string") {
    const d = cleanText(b.directive, 2000);
    data.directive = d || null;
    data.directiveAt = d ? new Date() : null;
  }
  if (typeof b.abNotes === "string") {
    data.abNotes = cleanText(b.abNotes, 2000) || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  }
  const campaign = await prisma.campaign.update({ where: { id }, data });
  await log("UI", `Campaign "${campaign.name}" directive/notes updated.`);
  return NextResponse.json({ ok: true });
}

// Campaigns that have ever gone live carry real ad-platform state (and spend
// history) — those can only be stopped, never deleted. Everything before that
// point is disposable.
const NOT_LAUNCHED_STATUSES = ["DRAFT", "NEEDS_CLARIFICATION", "READY", "ERROR"];

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!NOT_LAUNCHED_STATUSES.includes(campaign.status)) {
    return NextResponse.json({ error: "This campaign has already launched — stop it instead of deleting it." }, { status: 409 });
  }
  await prisma.campaign.delete({ where: { id } });
  await log("UI", `Campaign "${campaign.name}" deleted before launch.`);
  return NextResponse.json({ ok: true });
}
