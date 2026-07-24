import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/db", () => ({
  prisma: { client: { update: vi.fn() } },
  log: vi.fn(),
}));
vi.mock("../lib/meta", () => ({
  credsFromClient: vi.fn((c) => ({ token: c.metaAccessToken, accountId: c.metaAdAccountId, pageId: c.metaPageId })),
  verifyCredentials: vi.fn(),
}));
vi.mock("../lib/email", () => ({ notifyAdminOfVerifyFailure: vi.fn() }));

import { prisma } from "../lib/db";
import { verifyCredentials } from "../lib/meta";
import { notifyAdminOfVerifyFailure } from "../lib/email";
import { runReadinessCheck } from "../lib/verifyClient";

const client = {
  id: "c1",
  name: "Acme",
  metaAccessToken: "t",
  metaAdAccountId: "123",
  metaPageId: "999",
  lastAdminNotifyAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("runReadinessCheck", () => {
  it("persists VERIFIED status and skips admin notify when ready", async () => {
    (verifyCredentials as ReturnType<typeof vi.fn>).mockResolvedValue({ ready: true, checks: [] });
    const result = await runReadinessCheck(client, "CRON");
    expect(result.ready).toBe(true);
    expect(result.checkedAt).toEqual(expect.any(String));
    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "VERIFIED", verifyResultJson: JSON.stringify({ ready: true, checks: [], checkedAt: result.checkedAt }) },
    });
    expect(notifyAdminOfVerifyFailure).not.toHaveBeenCalled();
  });

  it("persists ERROR status and notifies the admin when not ready", async () => {
    const checks = [{ item: "Access token", ok: false, detail: "Invalid token." }];
    (verifyCredentials as ReturnType<typeof vi.fn>).mockResolvedValue({ ready: false, checks });
    (notifyAdminOfVerifyFailure as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: true });
    const result = await runReadinessCheck(client, "UI");
    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "ERROR", verifyResultJson: JSON.stringify({ ready: false, checks, checkedAt: result.checkedAt }) },
    });
    expect(notifyAdminOfVerifyFailure).toHaveBeenCalledWith(client, checks);
  });

  it("doesn't throw when notify itself fails", async () => {
    (verifyCredentials as ReturnType<typeof vi.fn>).mockResolvedValue({ ready: false, checks: [{ item: "x", ok: false, detail: "y" }] });
    (notifyAdminOfVerifyFailure as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("resend down"));
    await expect(runReadinessCheck(client, "CRON")).resolves.toMatchObject({ ready: false });
  });
});
