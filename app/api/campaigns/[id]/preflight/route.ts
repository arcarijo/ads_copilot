import { NextRequest, NextResponse } from "next/server";
import { preflightCampaign } from "@/lib/preflight";
import { requireSession, canAccessCampaign } from "@/lib/auth";

/** Aggressive read-only pre-launch validation. Never mutates anything. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await preflightCampaign(id);
  return NextResponse.json(result);
}
