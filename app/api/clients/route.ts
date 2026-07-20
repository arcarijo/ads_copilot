import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, clientScope } from "@/lib/auth";
import { validateClientFields } from "@/lib/sanitize";

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

  const result = validateClientFields(b, "create");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 });
  const v = result.values;

  const client = await prisma.client.create({
    data: {
      name: v.name!,
      contactEmail: v.contactEmail ?? null,
      website: v.website ?? null,
      socialLinksJson: JSON.stringify(v.socialLinks ?? []),
      gmbUrl: v.gmbUrl ?? null,
      metaAdAccountId: v.metaAdAccountId!,
      metaPageId: v.metaPageId!,
      metaSystemUserId: v.metaSystemUserId ?? null,
      metaSystemUserName: v.metaSystemUserName ?? null,
      metaAppId: v.metaAppId ?? null,
      metaAccessToken: v.metaAccessToken!,
      metaAppToken: v.metaAppToken ?? null,
    },
  });
  return NextResponse.json({ clientId: client.id });
}
