import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";
import { validateClientFields } from "@/lib/sanitize";

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
      id: true, name: true, contactEmail: true, clerkUserId: true, reportFrequency: true,
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

  // Meta credentials and user assignment stay admin-only — strip them for
  // non-admins before anything is validated or written.
  if (!admin) {
    delete b.metaAdAccountId; delete b.metaPageId; delete b.metaAccessToken;
    delete b.metaSystemUserName; delete b.metaSystemUserId; delete b.metaAppId; delete b.metaAppToken;
  }

  // Everything except cadence + assignment goes through the shared sanitizer.
  const result = validateClientFields(b, "update");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 });
  const val = result.values;

  const data: Record<string, unknown> = {};
  // Report cadence: the owner's own preference — any role with access.
  if (b.reportFrequency !== undefined && ["DAILY", "WEEKLY", "OFF"].includes(b.reportFrequency)) {
    data.reportFrequency = b.reportFrequency;
  }
  if (admin && b.clerkUserId !== undefined) data.clerkUserId = b.clerkUserId || null;
  if (val.name !== undefined) data.name = val.name;
  if (val.contactEmail !== undefined) data.contactEmail = val.contactEmail;
  if (val.website !== undefined) data.website = val.website;
  if (val.gmbUrl !== undefined) data.gmbUrl = val.gmbUrl;
  if (val.socialLinks !== undefined) data.socialLinksJson = JSON.stringify(val.socialLinks);
  if (val.metaAdAccountId !== undefined) data.metaAdAccountId = val.metaAdAccountId;
  if (val.metaPageId !== undefined) data.metaPageId = val.metaPageId;
  if (val.metaAccessToken !== undefined) data.metaAccessToken = val.metaAccessToken;
  if (val.metaSystemUserName !== undefined) data.metaSystemUserName = val.metaSystemUserName;
  if (val.metaSystemUserId !== undefined) data.metaSystemUserId = val.metaSystemUserId;
  if (val.metaAppId !== undefined) data.metaAppId = val.metaAppId;
  if (val.metaAppToken !== undefined) data.metaAppToken = val.metaAppToken;

  // Editing credentials invalidates a prior VERIFIED status until re-checked.
  if (val.metaAccessToken !== undefined || val.metaAdAccountId !== undefined || val.metaPageId !== undefined) {
    data.status = "PENDING";
    data.verifyResultJson = null;
  }

  const client = await prisma.client.update({ where: { id }, data });
  await log("UI", `Client "${client.name}" updated.`);
  return NextResponse.json({ ok: true, client: { id: client.id, name: client.name } });
}

/** Delete a client and everything under it (campaigns/alerts cascade). Admin only. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const { id } = await params;
  const existing = await prisma.client.findUnique({ where: { id }, select: { name: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.client.delete({ where: { id } });
  await log("UI", `Client "${existing.name}" deleted.`);
  return NextResponse.json({ ok: true });
}
