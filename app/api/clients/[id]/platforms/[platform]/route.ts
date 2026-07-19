import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";
import { platformSpec } from "@/lib/platforms";

/**
 * Update one platform connection:
 *  - { directive } — platform-specific manager directive; any role with access.
 *  - { creds: {field: value} } — admin only; merged over existing (blank = keep).
 * Filling every required field flips status to CONNECTED.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; platform: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id, platform } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const spec = platformSpec(platform);
  if (!spec) return NextResponse.json({ error: "Unknown platform." }, { status: 422 });
  const b = await req.json().catch(() => ({}));

  const existing = await prisma.platformConnection.findUnique({
    where: { clientId_platform: { clientId: id, platform: spec.key } },
  });
  if (!existing) return NextResponse.json({ error: "Enable the platform first." }, { status: 422 });

  const data: Record<string, unknown> = {};

  if (typeof b.directive === "string") {
    data.directive = b.directive.trim();
    data.directiveAt = b.directive.trim() ? new Date() : null;
  }

  if (b.creds && typeof b.creds === "object") {
    if (auth.session.role !== "admin") {
      return NextResponse.json({ error: "Credential entry is handled by your admin — ask them to connect this platform." }, { status: 403 });
    }
    let creds: Record<string, string> = {};
    try {
      creds = JSON.parse(existing.credsJson);
    } catch {
      /* empty */
    }
    for (const f of spec.fields) {
      const v = b.creds[f.key];
      if (typeof v === "string" && v.trim() && v.trim() !== "••••••••") creds[f.key] = v.trim();
    }
    data.credsJson = JSON.stringify(creds);
    const complete = spec.fields.filter((f) => f.required).every((f) => creds[f.key]);
    data.status = complete ? "CONNECTED" : "PENDING";
  }

  await prisma.platformConnection.update({
    where: { clientId_platform: { clientId: id, platform: spec.key } },
    data,
  });
  await log("UI", `Platform ${spec.key} updated (${Object.keys(data).join(", ")}).`, { detail: { clientId: id } });
  return NextResponse.json({ ok: true });
}
