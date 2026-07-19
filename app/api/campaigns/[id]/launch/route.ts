import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { launchToMeta } from "@/lib/launcher";
import { preflightCampaign } from "@/lib/preflight";
import { MetaApiError } from "@/lib/types";
import { GuardrailViolation } from "@/lib/guardrails";
import { requireSession, canAccessCampaign } from "@/lib/auth";

/**
 * HITL Gate #1: this route only fires when the user clicks "Approve & Launch"
 * on the plan receipt. Billing/account errors surface as structured alerts,
 * never as crashes.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessCampaign(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Server-side preflight gate: even if the UI check were skipped, we refuse to
  // touch Meta unless every blocking validation passes. `?force=1` lets the
  // caller proceed past non-blocking warnings only (errors always block).
  const preflight = await preflightCampaign(id);
  if (!preflight.ready) {
    const failures = preflight.checks.filter((c) => c.severity === "error" && !c.ok);
    await log("META", `Launch blocked by preflight: ${failures.map((f) => f.item).join(", ")}`, {
      campaignId: id,
      level: "WARN",
      detail: preflight,
    });
    return NextResponse.json(
      { ok: false, error: "Preflight validation failed — resolve the issues below before launching.", preflight },
      { status: 422 }
    );
  }

  try {
    await launchToMeta(id);
    return NextResponse.json({ ok: true, status: "ACTIVE" });
  } catch (err) {
    const isMeta = err instanceof MetaApiError;
    const isGuardrail = err instanceof GuardrailViolation;
    const message = isMeta ? err.humanMessage : (err as Error).message;
    const alertType = isMeta
      ? err.kind === "BILLING"
        ? "BILLING_ERROR"
        : err.kind === "ACCOUNT_RESTRICTED"
          ? "ACCOUNT_RESTRICTED"
          : err.kind === "TOKEN_INVALID"
            ? "TOKEN_INVALID"
            : "GENERAL"
      : "GENERAL";

    await prisma.campaign.update({
      where: { id },
      data: { status: isGuardrail ? "READY" : "ERROR", lastError: message },
    });
    await prisma.alert.create({ data: { campaignId: id, type: alertType, message } });
    await log("META", `Launch failed: ${message}`, { campaignId: id, level: "ERROR" });

    return NextResponse.json({ ok: false, error: message, kind: isMeta ? err.kind : "APP" }, { status: 422 });
  }
}
