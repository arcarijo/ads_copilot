import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Explicit select: access tokens NEVER leave the server. Presence flags
  // are enough for the UI ("token on file" vs "missing").
  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true, name: true, contactEmail: true, userId: true, reportFrequency: true,
      website: true, socialLinksJson: true, gmbUrl: true,
      metaAdAccountId: true, metaPageId: true, metaSystemUserId: true,
      metaSystemUserName: true, metaAppId: true,
      metaAccessToken: true, metaAppToken: true,
      status: true, verifyResultJson: true, createdAt: true, updatedAt: true,
      profile: true,
      researchRuns: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { metaAccessToken, metaAppToken, ...safe } = client;
  return NextResponse.json({
    client: { ...safe, hasAccessToken: Boolean(metaAccessToken), hasAppToken: Boolean(metaAppToken) },
  });
}

/** Edit client details and/or Meta credentials. Only provided fields change. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const b = await req.json().catch(() => ({}));
  const admin = auth.session.role === "admin";

  const data: Record<string, unknown> = {};
  // Report cadence: the owner's own preference — any role with access.
  if (b.reportFrequency !== undefined && ["DAILY", "WEEKLY", "OFF"].includes(b.reportFrequency)) {
    data.reportFrequency = b.reportFrequency;
  }
  // Meta credentials and user assignment stay admin-only.
  if (!admin) {
    delete b.metaAdAccountId; delete b.metaPageId; delete b.metaAccessToken;
    delete b.metaSystemUserName; delete b.metaSystemUserId; delete b.metaAppId; delete b.metaAppToken;
  }
  if (admin && b.userId !== undefined) data.userId = b.userId || null;
  if (b.name !== undefined) data.name = String(b.name).trim() || undefined;
  if (b.contactEmail !== undefined) data.contactEmail = b.contactEmail || null;
  if (b.website !== undefined) data.website = b.website || null;
  if (b.gmbUrl !== undefined) data.gmbUrl = b.gmbUrl || null;
  if (b.socialLinks !== undefined)
    data.socialLinksJson = JSON.stringify((b.socialLinks ?? []).map((s: string) => s.trim()).filter(Boolean));
  if (b.metaAdAccountId !== undefined) data.metaAdAccountId = String(b.metaAdAccountId).replace(/^act_/, "");
  if (b.metaPageId !== undefined) data.metaPageId = String(b.metaPageId);
  if (b.metaAccessToken) data.metaAccessToken = b.metaAccessToken;
  if (b.metaSystemUserName !== undefined) data.metaSystemUserName = b.metaSystemUserName || null;
  if (b.metaSystemUserId !== undefined) data.metaSystemUserId = b.metaSystemUserId || null;
  if (b.metaAppId !== undefined) data.metaAppId = b.metaAppId || null;
  if (b.metaAppToken) data.metaAppToken = b.metaAppToken;

  // Editing credentials invalidates a prior VERIFIED status until re-checked.
  if (b.metaAccessToken || b.metaAdAccountId !== undefined || b.metaPageId !== undefined) {
    data.status = "PENDING";
    data.verifyResultJson = null;
  }

  const client = await prisma.client.update({ where: { id }, data });
  await log("UI", `Client "${client.name}" updated.`);
  return NextResponse.json({ ok: true, client: { id: client.id, name: client.name } });
}
