import { PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret } from "./crypto";

// Secret columns are encrypted at rest (AES-256-GCM, lib/crypto.ts) via this
// Prisma extension: writes encrypt, reads decrypt — transparently, so callers
// (lib/meta.ts, routes) keep working with plaintext values in memory. Legacy
// plaintext rows pass through unchanged and get encrypted on next write.
function buildPrisma() {
  const encClient = (d: Record<string, unknown> | undefined) => {
    if (!d) return;
    if (typeof d.metaAccessToken === "string" && d.metaAccessToken) d.metaAccessToken = encryptSecret(d.metaAccessToken);
    if (typeof d.metaAppToken === "string" && d.metaAppToken) d.metaAppToken = encryptSecret(d.metaAppToken);
  };
  const encConn = (d: Record<string, unknown> | undefined) => {
    if (!d) return;
    if (typeof d.credsJson === "string" && d.credsJson) d.credsJson = encryptSecret(d.credsJson);
  };

  return new PrismaClient().$extends({
    query: {
      client: {
        $allOperations({ operation, args, query }) {
          if (["create", "update", "upsert"].includes(operation)) {
            const a = args as { data?: Record<string, unknown>; create?: Record<string, unknown>; update?: Record<string, unknown> };
            encClient(a.data);
            encClient(a.create);
            encClient(a.update);
          }
          return query(args);
        },
      },
      platformConnection: {
        $allOperations({ operation, args, query }) {
          if (["create", "update", "upsert"].includes(operation)) {
            const a = args as { data?: Record<string, unknown>; create?: Record<string, unknown>; update?: Record<string, unknown> };
            encConn(a.data);
            encConn(a.create);
            encConn(a.update);
          }
          return query(args);
        },
      },
    },
    result: {
      client: {
        metaAccessToken: {
          needs: { metaAccessToken: true },
          compute: (c) => decryptSecret(c.metaAccessToken),
        },
        metaAppToken: {
          needs: { metaAppToken: true },
          compute: (c) => (c.metaAppToken == null ? c.metaAppToken : decryptSecret(c.metaAppToken)),
        },
      },
      platformConnection: {
        credsJson: {
          needs: { credsJson: true },
          compute: (c) => decryptSecret(c.credsJson),
        },
      },
    },
  });
}

type ExtendedPrisma = ReturnType<typeof buildPrisma>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrisma };

export const prisma = globalForPrisma.prisma ?? buildPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function log(
  source: string,
  message: string,
  opts: { campaignId?: string; level?: "INFO" | "WARN" | "ERROR"; detail?: unknown } = {}
) {
  await prisma.log.create({
    data: {
      source,
      message,
      level: opts.level ?? "INFO",
      campaignId: opts.campaignId,
      detailJson: opts.detail !== undefined ? JSON.stringify(opts.detail) : undefined,
    },
  });
}
