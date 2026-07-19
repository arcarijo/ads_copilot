import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, canAccessClient } from "@/lib/auth";
import { credsFromClient, listRemoteAudiences } from "@/lib/meta";
import { MetaApiError } from "@/lib/types";

/** Read-only: what audiences currently exist on the client's Meta ad account. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!(await canAccessClient(auth.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  try {
    const remote = await listRemoteAudiences(credsFromClient(client));
    return NextResponse.json({ remote });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
