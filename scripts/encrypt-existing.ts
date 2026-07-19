// One-off migration: re-save every secret column through the extended Prisma
// client so legacy plaintext rows become AES-256-GCM encrypted at rest.
// Idempotent — decrypt-on-read + encrypt-on-write means running it twice is a
// no-op. Run: npx tsx --env-file=.env.local scripts/encrypt-existing.ts
import { prisma } from "../lib/db";

async function main() {
  if (!process.env.CREDS_SECRET) throw new Error("CREDS_SECRET is not set — aborting.");

  const clients = await prisma.client.findMany({ select: { id: true, metaAccessToken: true, metaAppToken: true } });
  for (const c of clients) {
    await prisma.client.update({
      where: { id: c.id },
      data: { metaAccessToken: c.metaAccessToken, metaAppToken: c.metaAppToken ?? undefined },
    });
  }
  console.log(`Re-encrypted ${clients.length} client credential row(s).`);

  const conns = await prisma.platformConnection.findMany({ select: { id: true, credsJson: true } });
  for (const p of conns) {
    await prisma.platformConnection.update({ where: { id: p.id }, data: { credsJson: p.credsJson } });
  }
  console.log(`Re-encrypted ${conns.length} platform connection row(s).`);

  // Spot-check: raw DB values must now carry the enc:v1: prefix.
  const raw = await prisma.$queryRaw<{ metaAccessToken: string }[]>`SELECT "metaAccessToken" FROM "Client" LIMIT 3`;
  for (const r of raw) {
    console.log(`  raw column starts with: ${r.metaAccessToken.slice(0, 12)}…`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
