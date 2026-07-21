import { NextRequest, NextResponse } from "next/server";
import { preflightCampaign } from "@/lib/preflight";
import { requireSession, canAccessCampaign } from "@/lib/auth";
import { aiRateLimited } from "@/lib/rateLimit";

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
  const result = await preflightCampaign(id, { includeAi });
  return NextResponse.json(result);
}
