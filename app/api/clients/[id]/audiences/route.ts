import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";
import { credsFromClient } from "@/lib/meta";
import { createAudience } from "@/lib/audiences";
import { MetaApiError } from "@/lib/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const audiences = await prisma.metaAudience.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, name: true, metaAudienceId: true, sourceNote: true, status: true, createdAt: true },
  });
  return NextResponse.json({ audiences });
}

/** Create an audience asset from an Audience Studio form submission. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const b = await req.json().catch(() => ({}));
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });

  try {
    const result = await createAudience(credsFromClient(client), id, String(b.kind ?? ""), b.input ?? {});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
