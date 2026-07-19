import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { credsFromClient, envCreds, pauseEntity } from "@/lib/meta";
import { MetaApiError } from "@/lib/types";
import { requireSession, canAccessCampaign } from "@/lib/auth";

/**
 * EMERGENCY STOP: instantly pauses the Meta campaign (which halts all child
 * ad sets and ads) and marks it STOPPED locally.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { client: true } });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    if (campaign.metaCampaignId) {
      const creds = campaign.client ? credsFromClient(campaign.client) : envCreds();
      await pauseEntity(creds, campaign.metaCampaignId);
    }
    await prisma.campaign.update({ where: { id }, data: { status: "STOPPED" } });
    await log("UI", "EMERGENCY STOP executed — campaign paused on Meta.", { campaignId: id, level: "WARN" });
    return NextResponse.json({ ok: true, status: "STOPPED" });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    await log("UI", `Emergency stop failed: ${message}`, { campaignId: id, level: "ERROR" });
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
