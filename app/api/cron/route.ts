import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { optimizeCampaign } from "@/lib/optimizer";
import { safeEqual } from "@/lib/crypto";

export const maxDuration = 300;

/**
 * Daily autonomous optimizer, secured by CRON_SECRET.
 * Vercel cron sends "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const active = await prisma.campaign.findMany({ where: { status: "ACTIVE" } });
  const results: Record<string, unknown> = {};

  for (const campaign of active) {
    try {
      results[campaign.id] = await optimizeCampaign(campaign.id);
    } catch (err) {
      const message = (err as Error).message;
      results[campaign.id] = { error: message };
      await log("CRON", `Optimization failed: ${message}`, { campaignId: campaign.id, level: "ERROR" });
    }
  }

  await log("CRON", `Daily cycle complete for ${active.length} active campaign(s).`, { detail: results });
  return NextResponse.json({ ok: true, campaignsProcessed: active.length, results });
}
