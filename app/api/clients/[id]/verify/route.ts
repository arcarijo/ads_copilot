import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runReadinessCheck } from "@/lib/verifyClient";
import { requireSession, canAccessClient } from "@/lib/auth";

export const maxDuration = 60;

/** Live Meta credential readiness check for the onboarding form and Platforms panel. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await runReadinessCheck(client, "UI");
  return NextResponse.json(result);
}
