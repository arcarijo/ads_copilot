import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { notifyAdminOfVerifyFailure } from "@/lib/email";
import { requireSession, canAccessClient } from "@/lib/auth";
import type { VerifyCheck } from "@/lib/meta";

/** Client-triggered "email admin about this" action for a failed credential check. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let checks: VerifyCheck[] = [];
  try {
    checks = client.verifyResultJson ? (JSON.parse(client.verifyResultJson).checks as VerifyCheck[]) : [];
  } catch {
    checks = [];
  }
  if (checks.length === 0) {
    return NextResponse.json({ error: "No credential check has been run for this client yet." }, { status: 400 });
  }

  const result = await notifyAdminOfVerifyFailure(client, checks, { manual: true });
  await log("UI", `Manual admin notify for ${client.name}: ${result.sent ? "sent" : result.reason}`, {});
  return NextResponse.json(result);
}
