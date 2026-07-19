import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, clientScope } from "@/lib/auth";

export async function GET() {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const clients = await prisma.client.findMany({
    where: clientScope(auth.session),
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, contactEmail: true, website: true, status: true,
      metaAdAccountId: true, metaPageId: true, createdAt: true,
      profile: { select: { version: true, updatedAt: true } },
      _count: { select: { campaigns: true } },
    },
  });
  return NextResponse.json({ clients });
}

/** Onboarding carries Meta credentials — admin only. */
export async function POST(req: NextRequest) {
  const auth = await requireSession("admin");
  if (auth.response) return auth.response;
  const b = await req.json().catch(() => ({}));
  const required = ["name", "metaAdAccountId", "metaPageId", "metaAccessToken"];
  for (const f of required) {
    if (!b[f]?.toString().trim()) {
      return NextResponse.json({ error: `Missing required field: ${f}` }, { status: 422 });
    }
  }
  const client = await prisma.client.create({
    data: {
      name: b.name,
      contactEmail: b.contactEmail || null,
      website: b.website || null,
      socialLinksJson: JSON.stringify((b.socialLinks ?? []).filter(Boolean)),
      gmbUrl: b.gmbUrl || null,
      metaAdAccountId: String(b.metaAdAccountId).replace(/^act_/, ""),
      metaPageId: String(b.metaPageId),
      metaSystemUserId: b.metaSystemUserId || null,
      metaSystemUserName: b.metaSystemUserName || null,
      metaAppId: b.metaAppId || null,
      metaAccessToken: b.metaAccessToken,
      metaAppToken: b.metaAppToken || null,
    },
  });
  return NextResponse.json({ clientId: client.id });
}
