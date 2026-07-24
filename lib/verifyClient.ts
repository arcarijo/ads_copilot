import { prisma, log } from "./db";
import { credsFromClient, verifyCredentials, type VerifyCheck } from "./meta";
import { notifyAdminOfVerifyFailure } from "./email";
import type { Client } from "@prisma/client";

export interface VerifyResult {
  ready: boolean;
  checks: VerifyCheck[];
  checkedAt: string;
}

/**
 * Single source of truth for "check this client's Meta credentials, persist
 * the result, and alert the admin on failure" — shared by the on-demand
 * verify route and the daily cron sweep so both stay in lockstep.
 */
export async function runReadinessCheck(
  client: Pick<Client, "id" | "name" | "metaAccessToken" | "metaAdAccountId" | "metaPageId" | "lastAdminNotifyAt">,
  source: "UI" | "CRON",
): Promise<VerifyResult> {
  const raw = await verifyCredentials(credsFromClient(client));
  // checkedAt lets the UI confirm a re-run actually happened even when the
  // result is unchanged — otherwise a click that reproduces the same failure
  // looks indistinguishable from a broken button.
  const result: VerifyResult = { ...raw, checkedAt: new Date().toISOString() };
  await prisma.client.update({
    where: { id: client.id },
    data: { status: result.ready ? "VERIFIED" : "ERROR", verifyResultJson: JSON.stringify(result) },
  });
  await log(source, `Credential check for ${client.name}: ${result.ready ? "READY" : "NOT READY"}`, { detail: result });

  if (!result.ready) {
    await notifyAdminOfVerifyFailure(client, result.checks).catch((err) =>
      log(source, `Admin notify failed for ${client.name}: ${(err as Error).message}`, { level: "WARN" }),
    );
  }
  return result;
}
