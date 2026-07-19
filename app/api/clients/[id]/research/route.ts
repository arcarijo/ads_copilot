import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runResearch } from "@/lib/research";
import { requireSession, canAccessClient } from "@/lib/auth";

/**
 * Triggers a research run. Optional body:
 *  - sources: { website, gmbUrl, socialLinks[] } — saved to the client first,
 *    so the scrape uses the confirmed data sources.
 *  - extraUrls: string[] — one-off URLs scraped for this run only.
 *  - marketDescription: string — triggers a MARKET_EXTENSION run instead.
 * Rate-capped inside runResearch.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));

  // Persist confirmed data sources before scraping.
  if (body.sources) {
    const s = body.sources;
    await prisma.client.update({
      where: { id },
      data: {
        website: s.website || null,
        gmbUrl: s.gmbUrl || null,
        socialLinksJson: JSON.stringify((s.socialLinks ?? []).map((x: string) => x.trim()).filter(Boolean)),
      },
    });
  }

  const type = body.marketDescription ? "MARKET_EXTENSION" : "INITIAL";
  const result = await runResearch(id, {
    type,
    trigger: body.trigger ?? "manual",
    marketDescription: body.marketDescription,
    extraUrls: Array.isArray(body.extraUrls) ? body.extraUrls.map((x: string) => x.trim()).filter(Boolean) : [],
  });
  return NextResponse.json(result, { status: result.status === "FAILED" ? 422 : 200 });
}
