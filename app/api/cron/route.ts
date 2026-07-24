import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { optimizeCampaign } from "@/lib/optimizer";
import { runReadinessCheck } from "@/lib/verifyClient";
import { safeEqual } from "@/lib/crypto";

export const maxDuration = 300;

/**
 * Daily autonomous optimizer + Meta credential readiness sweep, secured by
 * CRON_SECRET. Vercel cron sends "Authorization: Bearer <CRON_SECRET>".
 *
 * The readiness sweep is what makes "Credential readiness" more than a
 * manual, click-to-check panel — every client with Meta creds on file gets
 * re-verified once a day even if nobody opens their Platforms page, so a
 * revoked token or permission change surfaces (and pages the admin) on its
 * own instead of waiting for someone to notice ads stopped launching.
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

  const clientsWithMeta = await prisma.client.findMany({
    where: { metaAccessToken: { not: "" }, metaAdAccountId: { not: "" }, metaPageId: { not: "" } },
  });
  const readinessResults: Record<string, unknown> = {};

  for (const client of clientsWithMeta) {
    try {
      readinessResults[client.id] = await runReadinessCheck(client, "CRON");
    } catch (err) {
      const message = (err as Error).message;
      readinessResults[client.id] = { error: message };
      await log("CRON", `Readiness check failed for ${client.name}: ${message}`, { level: "ERROR" });
    }
  }

  await log("CRON", `Daily readiness sweep complete for ${clientsWithMeta.length} client(s).`, {
    detail: readinessResults,
  });

  return NextResponse.json({
    ok: true,
    campaignsProcessed: active.length,
    results,
    clientsVerified: clientsWithMeta.length,
    readinessResults,
  });
}
