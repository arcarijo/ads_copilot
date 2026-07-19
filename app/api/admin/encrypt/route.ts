import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";

/**
 * Admin utility: force-encrypt every stored credential row. New writes are
 * always encrypted by the Prisma extension (lib/db.ts); this sweeps legacy
 * plaintext rows in one pass. Idempotent. Auth: admin session, or
 * "Authorization: Bearer <CREDS_SECRET>" for operational one-off runs.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const bearer = req.headers.get("authorization");
  const secret = process.env.CREDS_SECRET;
  const authorized = session?.role === "admin" || (secret && safeEqual(bearer, `Bearer ${secret}`));
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!secret) return NextResponse.json({ error: "CREDS_SECRET is not configured." }, { status: 503 });

  const clients = await prisma.client.findMany({ select: { id: true, metaAccessToken: true, metaAppToken: true } });
  for (const c of clients) {
    await prisma.client.update({
      where: { id: c.id },
      data: { metaAccessToken: c.metaAccessToken, metaAppToken: c.metaAppToken ?? undefined },
    });
  }
  const conns = await prisma.platformConnection.findMany({ select: { id: true, credsJson: true } });
  for (const p of conns) {
    await prisma.platformConnection.update({ where: { id: p.id }, data: { credsJson: p.credsJson } });
  }

  // Verify at the raw column level — count rows still lacking the enc prefix.
  const [{ plain }] = await prisma.$queryRaw<{ plain: bigint }[]>`
    SELECT COUNT(*)::bigint AS "plain" FROM "Client" WHERE "metaAccessToken" NOT LIKE 'enc:v1:%'`;
  const [{ plainConn }] = await prisma.$queryRaw<{ plainConn: bigint }[]>`
    SELECT COUNT(*)::bigint AS "plainConn" FROM "PlatformConnection" WHERE "credsJson" NOT LIKE 'enc:v1:%'`;

  await log("UI", `Credential encryption sweep: ${clients.length} clients, ${conns.length} connections.`);
  return NextResponse.json({
    ok: true,
    clients: clients.length,
    connections: conns.length,
    stillPlaintext: { clients: Number(plain), connections: Number(plainConn) },
  });
}
