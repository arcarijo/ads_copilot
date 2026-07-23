import { log, prisma } from "./db";
import type { Client } from "@prisma/client";
import type { VerifyCheck } from "./meta";

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  campaignId?: string;
  alertType?: string; // when set, also records a dashboard Alert
}

/**
 * Email dispatcher. Sends for real via Resend when RESEND_API_KEY is set
 * (free tier: resend.com), otherwise falls back to a mock that logs and
 * records a dashboard alert so nothing is silently lost. Set EMAIL_FROM to a
 * verified sender (defaults to onboarding@resend.dev for quick testing).
 */
export async function sendEmail(input: EmailInput): Promise<{ delivered: boolean; via: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "AI Ad Manager <onboarding@resend.dev>";

  let delivered = false;
  let via = "mock";

  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html ?? undefined,
        }),
      });
      delivered = res.ok;
      via = "resend";
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        await log("OPTIMIZER", `Resend delivery failed (${res.status}): ${body.slice(0, 200)}`, {
          campaignId: input.campaignId,
          level: "WARN",
        });
      }
    } catch (err) {
      await log("OPTIMIZER", `Resend request error: ${(err as Error).message}`, {
        campaignId: input.campaignId,
        level: "WARN",
      });
    }
  }

  if (!delivered) {
    console.log(`[MOCK EMAIL] to=${input.to} subject="${input.subject}"\n${input.text}`);
  }

  await log("OPTIMIZER", `Email ${delivered ? "sent via Resend" : "logged (mock)"} to ${input.to}: ${input.subject}`, {
    campaignId: input.campaignId,
    detail: { text: input.text, delivered, via },
  });

  if (input.alertType) {
    await prisma.alert.create({
      data: {
        campaignId: input.campaignId,
        type: input.alertType,
        message: `${input.subject} — ${input.text}`,
      },
    });
  }

  return { delivered, via };
}

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "owner@example.com";
// Shared across auto (on verify failure) and manual ("Email admin") triggers
// so a client repeatedly re-running the check, or repeatedly clicking the
// button, can't spam the admin inbox / burn Resend quota.
const ADMIN_NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Emails the admin about a client's failing Meta credential checks, rate-limited
 * per client via Client.lastAdminNotifyAt. Returns whether it actually sent.
 */
export async function notifyAdminOfVerifyFailure(
  client: Pick<Client, "id" | "name" | "lastAdminNotifyAt">,
  checks: VerifyCheck[],
  opts: { manual?: boolean } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const failing = checks.filter((c) => !c.ok);
  if (failing.length === 0) return { sent: false, reason: "No failing checks." };

  if (client.lastAdminNotifyAt) {
    const elapsed = Date.now() - client.lastAdminNotifyAt.getTime();
    if (elapsed < ADMIN_NOTIFY_COOLDOWN_MS) {
      return { sent: false, reason: `Already notified ${Math.ceil(elapsed / 60000)} min ago — please wait before re-sending.` };
    }
  }

  const lines = failing.map((c) => `- ${c.item}: ${c.detail}`).join("\n");
  await sendEmail({
    to: NOTIFY_EMAIL,
    subject: `Meta credential check failing for ${client.name}`,
    text: `${opts.manual ? "A client manually requested help with" : "Automatic readiness check found"} problem(s) for "${client.name}":\n\n${lines}\n\nOpen the client's Platforms page to review.`,
    alertType: "META_VERIFY_FAILED",
  });
  await prisma.client.update({ where: { id: client.id }, data: { lastAdminNotifyAt: new Date() } });
  return { sent: true };
}
