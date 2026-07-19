import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";
import { platformSpec } from "@/lib/platforms";

/** List this client's platform connections with secrets masked. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await prisma.platformConnection.findMany({ where: { clientId: id } });
  const connections = rows.map((r) => {
    const spec = platformSpec(r.platform);
    let creds: Record<string, string> = {};
    try {
      creds = JSON.parse(r.credsJson);
    } catch {
      /* empty */
    }
    // Mask secret fields; report presence only.
    const masked: Record<string, string> = {};
    for (const f of spec?.fields ?? []) {
      const v = creds[f.key];
      if (!v) continue;
      masked[f.key] = f.secret ? "••••••••" : v;
    }
    return {
      platform: r.platform,
      enabled: r.enabled,
      status: r.status,
      directive: r.directive,
      directiveAt: r.directiveAt,
      creds: masked,
    };
  });
  return NextResponse.json({ connections });
}

/** Toggle a platform on/off (creates the connection row on first enable). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const b = await req.json().catch(() => ({}));
  const spec = platformSpec(String(b.platform ?? ""));
  if (!spec) return NextResponse.json({ error: "Unknown platform." }, { status: 422 });
  const enabled = Boolean(b.enabled);

  const conn = await prisma.platformConnection.upsert({
    where: { clientId_platform: { clientId: id, platform: spec.key } },
    create: {
      clientId: id,
      platform: spec.key,
      enabled,
      // Meta is already wired through the client record's credentials.
      status: spec.key === "META" ? "CONNECTED" : "PENDING",
    },
    update: { enabled },
  });
  await log("UI", `Platform ${spec.key} ${enabled ? "enabled" : "disabled"} for client.`, { detail: { clientId: id } });
  return NextResponse.json({ ok: true, platform: conn.platform, enabled: conn.enabled, status: conn.status });
}
