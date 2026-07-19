import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { buildProfileMd, Sections, sectionsFromLegacyMd } from "@/lib/profile";
import { requireSession, canAccessClient } from "@/lib/auth";

/**
 * Manually create/update the strategy profile. Accepts either:
 *  - { sections: { key: content, ... } } — merged onto existing sections
 *    (used by the gap-fill form; only provided keys change), or
 *  - { profileMd, markets } — legacy freeform overwrite.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const b = await req.json().catch(() => ({}));

  const existing = await prisma.businessProfile.findUnique({ where: { clientId: id } });
  let sections: Sections = {};
  if (existing) {
    try {
      sections = JSON.parse(existing.sectionsJson) as Sections;
    } catch {
      sections = {};
    }
    if (Object.keys(sections).length === 0) sections = sectionsFromLegacyMd(existing.profileMd);
  }

  const directiveOnly = typeof b.directive === "string" && !b.sections && typeof b.profileMd !== "string";

  if (b.sections && typeof b.sections === "object") {
    for (const [k, v] of Object.entries(b.sections as Record<string, unknown>)) {
      if (typeof v === "string") sections[k] = v.trim();
    }
  } else if (typeof b.profileMd === "string") {
    sections = sectionsFromLegacyMd(b.profileMd);
  } else if (!directiveOnly) {
    return NextResponse.json({ error: "Provide sections, profileMd, or directive." }, { status: 422 });
  }

  const profileMd = buildProfileMd(sections);
  // A directive-only save is allowed even before any sections exist.
  if (!directiveOnly && !profileMd.trim()) return NextResponse.json({ error: "Profile is empty." }, { status: 422 });

  const directiveUpdate =
    typeof b.directive === "string"
      ? { directive: b.directive.trim(), directiveAt: b.directive.trim() ? new Date() : null }
      : {};

  const markets = Array.isArray(b.markets)
    ? b.markets.map((m: string) => m.trim()).filter(Boolean)
    : b.markets
      ? String(b.markets).split(",").map((m) => m.trim()).filter(Boolean)
      : existing
        ? (JSON.parse(existing.marketsJson) as string[])
        : [];

  const profile = await prisma.businessProfile.upsert({
    where: { clientId: id },
    create: {
      clientId: id,
      profileMd: profileMd || "# Business Overview\n(Pending — add strategy details.)",
      sectionsJson: JSON.stringify(sections),
      marketsJson: JSON.stringify(markets),
      ...directiveUpdate,
    },
    update: {
      ...(directiveOnly ? {} : { profileMd, sectionsJson: JSON.stringify(sections), marketsJson: JSON.stringify(markets), version: { increment: 1 } }),
      ...directiveUpdate,
    },
  });
  await log("UI", directiveOnly ? "Manager directive updated." : `Strategy profile updated manually (v${profile.version}).`, { detail: { clientId: id } });
  return NextResponse.json({ ok: true, version: profile.version });
}
