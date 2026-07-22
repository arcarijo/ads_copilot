import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { credsFromClient, verifyCredentials } from "@/lib/meta";
import { notifyAdminOfVerifyFailure } from "@/lib/email";
import { requireSession, canAccessClient } from "@/lib/auth";

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

  const result = await verifyCredentials(credsFromClient(client));
  await prisma.client.update({
    where: { id },
    data: { status: result.ready ? "VERIFIED" : "ERROR", verifyResultJson: JSON.stringify(result) },
  });
  await log("UI", `Credential check for ${client.name}: ${result.ready ? "READY" : "NOT READY"}`, {
    detail: result,
  });

  if (!result.ready) {
    // Surface the failure to the admin now, at check time, instead of the
    // client only discovering it later at launch.
    await notifyAdminOfVerifyFailure(client, result.checks).catch((err) =>
      log("UI", `Admin notify failed for ${client.name}: ${(err as Error).message}`, { level: "WARN" }),
    );
  }

  return NextResponse.json(result);
}
