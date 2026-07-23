import { NextRequest, NextResponse } from "next/server";
import { preflightCampaign } from "@/lib/preflight";
import { requireSession, canAccessCampaign } from "@/lib/auth";
import { aiRateLimited } from "@/lib/rateLimit";
import { log } from "@/lib/db";

// Runs several live Meta API calls plus a best-effort AI rating; give it more
// room than the platform default so a slow upstream response doesn't get cut
// off mid-request and returned to the client as a non-JSON error.
export const maxDuration = 60;

/** Aggressive read-only pre-launch validation. Never mutates anything. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // The AI readiness rating runs a 70B inference; skip just that part when
  // rate-limited so the structural checks still return promptly.
  const includeAi = !aiRateLimited(auth.session, req.headers);
  try {
    const result = await preflightCampaign(id, { includeAi });
    return NextResponse.json(result);
  } catch (err) {
    // Never let an unexpected failure fall through to Next's default HTML
    // error page — the client always expects JSON here. Log the real cause
    // server-side only; the client gets a generic message.
    await log("UI", `Preflight failed unexpectedly for campaign ${id}: ${(err as Error).message}`, {
      campaignId: id,
      level: "ERROR",
    }).catch(() => {});
    return NextResponse.json({ error: "Preflight check failed unexpectedly. Try again." }, { status: 500 });
  }
}
