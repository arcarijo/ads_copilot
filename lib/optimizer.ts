import { prisma, log } from "./db";
import { credsFromClient, envCreds, getInsights, pauseEntity } from "./meta";
import { runLlamaJson, SMART_MODEL } from "./ai";
import { OPTIMIZER_SYSTEM_PROMPT } from "./prompts";
import { getGroundTruth } from "./research";
import { sendEmail } from "./email";
import { MAX_ACTIONS_PER_CYCLE } from "./guardrails";
import { MetaInsightsRow, OptimizerAction, OptimizerResult } from "./types";

const ALLOWED_ACTIONS = new Set(["KEEP", "PAUSE_AD", "PAUSE_ADSET", "PAUSE_CAMPAIGN", "RECOMMEND_BUDGET_INCREASE"]);
const USER_EMAIL = process.env.NOTIFY_EMAIL ?? "owner@example.com";

// Report HTML interpolates model-generated and owner-entered text (campaign
// name, AI summary, reasons, insight questions). Escape every such value so a
// prompt-injected or hand-typed image/onerror payload can't become active
// markup in the recipient's inbox. Plain-text email needs no escaping.
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function yesterdayRange(): { since: string; until: string; day: string } {
  const d = new Date(Date.now() - 86_400_000);
  const day = d.toISOString().slice(0, 10);
  return { since: day, until: day, day };
}

function conversions(row: MetaInsightsRow): number {
  return (row.actions ?? [])
    .filter((a) => /lead|purchase|complete_registration|onsite_conversion/.test(a.action_type))
    .reduce((s, a) => s + Number(a.value || 0), 0);
}

function cpaCents(row: MetaInsightsRow): number | null {
  const conv = conversions(row);
  const spend = Number(row.spend || 0);
  return conv > 0 ? Math.round((spend / conv) * 100) : null;
}

/**
 * One full "Fetch -> Think -> Act" optimization cycle for a single campaign.
 * The AI proposes; the code disposes. Every action passes a server-side
 * allowlist, target-id validation, and the no-budget-increase hard wall.
 */
export async function optimizeCampaign(campaignId: string): Promise<{ executed: string[]; blocked: string[] }> {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { client: true },
  });
  if (campaign.status !== "ACTIVE" || !campaign.metaCampaignId) {
    return { executed: [], blocked: [] };
  }
  const creds = campaign.client ? credsFromClient(campaign.client) : envCreds();
  const notifyEmail = campaign.client?.contactEmail || USER_EMAIL;

  const { since, until, day } = yesterdayRange();

  // FETCH: yesterday's per-ad metrics from Meta.
  const rows = await getInsights(creds, campaign.metaCampaignId, { since, until, level: "ad" });
  const totalSpend = rows.reduce((s, r) => s + Number(r.spend || 0), 0);
  const totalImpr = rows.reduce((s, r) => s + Number(r.impressions || 0), 0);
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks || 0), 0);
  const totalConv = rows.reduce((s, r) => s + conversions(r), 0);

  await prisma.analyticsSnapshot.upsert({
    where: { campaignId_date: { campaignId, date: day } },
    create: {
      campaignId,
      date: day,
      spendCents: Math.round(totalSpend * 100),
      impressions: totalImpr,
      clicks: totalClicks,
      conversions: totalConv,
      ctr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0,
      cpm: totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0,
      cpaCents: totalConv > 0 ? Math.round((totalSpend / totalConv) * 100) : null,
      frequency: Number(rows[0]?.frequency ?? 0),
      rawJson: JSON.stringify(rows),
    },
    update: {
      spendCents: Math.round(totalSpend * 100),
      impressions: totalImpr,
      clicks: totalClicks,
      conversions: totalConv,
      ctr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0,
      rawJson: JSON.stringify(rows),
    },
  });

  if (rows.length === 0) {
    await log("CRON", "No insight rows for yesterday; skipping optimization.", { campaignId });
    return { executed: [], blocked: [] };
  }

  // THINK: hand the metrics to the Llama media buyer.
  const history = await prisma.analyticsSnapshot.findMany({
    where: { campaignId },
    orderBy: { date: "desc" },
    take: 7,
  });
  const businessInfo = await getGroundTruth(campaign.clientId);
  const validAdIds = new Set(rows.map((r) => r.ad_id).filter(Boolean) as string[]);
  const validAdSetIds = new Set(rows.map((r) => r.adset_id).filter(Boolean) as string[]);

  const metricsTable = rows.map((r) => ({
    ad_id: r.ad_id,
    adset_id: r.adset_id,
    ad_name: r.ad_name,
    spend_dollars: Number(r.spend || 0),
    impressions: Number(r.impressions || 0),
    clicks: Number(r.clicks || 0),
    ctr_pct: Number(r.ctr || 0),
    frequency: Number(r.frequency || 0),
    conversions: conversions(r),
    cpa_cents: cpaCents(r),
  }));

  const userPrompt = [
    "=== BUSINESS PROFILE ===",
    businessInfo,
    `=== CAMPAIGN ===`,
    JSON.stringify({
      name: campaign.name,
      objective: campaign.objective,
      budgetCents: campaign.budgetCents,
      budgetType: campaign.budgetType,
      abTest: campaign.abTest,
      abVariable: campaign.abVariable,
      daysLive: campaign.startTime ? Math.floor((Date.now() - campaign.startTime.getTime()) / 86_400_000) : 0,
      metaCampaignId: campaign.metaCampaignId,
    }),
    "=== YESTERDAY'S PER-AD METRICS ===",
    JSON.stringify(metricsTable, null, 1),
    "=== 7-DAY HISTORY (campaign totals) ===",
    JSON.stringify(
      history.map((h) => ({ date: h.date, spendCents: h.spendCents, ctr: h.ctr, conversions: h.conversions, cpaCents: h.cpaCents }))
    ),
    "Audit and emit your JSON actions now.",
  ].join("\n\n");

  let result: OptimizerResult;
  try {
    result = await runLlamaJson<OptimizerResult>(OPTIMIZER_SYSTEM_PROMPT, userPrompt, {
      model: SMART_MODEL,
      maxTokens: 1792,
      temperature: 0.3,
      kind: "OPTIMIZER",
    });
  } catch (err) {
    await log("OPTIMIZER", `AI cycle failed, no actions taken: ${(err as Error).message}`, {
      campaignId,
      level: "ERROR",
    });
    return { executed: [], blocked: [] };
  }

  // ACT: validate and execute. Fail-closed on anything unrecognized.
  const executed: string[] = [];
  const blocked: string[] = [];
  const actions = (result.actions ?? []).slice(0, MAX_ACTIONS_PER_CYCLE);

  for (const raw of actions) {
    const a = raw as OptimizerAction & { [k: string]: unknown };
    if (!ALLOWED_ACTIONS.has(a.action)) {
      blocked.push(`Unknown action "${a.action}" rejected.`);
      continue;
    }
    // Hard wall: strip any budget-bearing field the model may have smuggled in.
    if ("daily_budget" in a || "lifetime_budget" in a || "budgetCents" in a) {
      blocked.push(`Action ${a.action} carried budget fields; stripped.`);
    }

    try {
      switch (a.action) {
        case "KEEP":
          break;
        case "PAUSE_AD":
          if (!validAdIds.has(a.targetId)) {
            blocked.push(`PAUSE_AD rejected: unknown ad id ${a.targetId}.`);
            break;
          }
          await pauseEntity(creds, a.targetId);
          executed.push(`Paused ad ${a.targetId}: ${a.reason}`);
          break;
        case "PAUSE_ADSET":
          if (!validAdSetIds.has(a.targetId)) {
            blocked.push(`PAUSE_ADSET rejected: unknown ad set id ${a.targetId}.`);
            break;
          }
          await pauseEntity(creds, a.targetId);
          executed.push(`Paused ad set ${a.targetId}: ${a.reason}`);
          break;
        case "PAUSE_CAMPAIGN":
          if (a.targetId !== campaign.metaCampaignId) {
            blocked.push(`PAUSE_CAMPAIGN rejected: id mismatch.`);
            break;
          }
          await pauseEntity(creds, campaign.metaCampaignId);
          await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
          executed.push(`Paused campaign: ${a.reason}`);
          break;
        case "RECOMMEND_BUDGET_INCREASE":
          // HITL GATE: budget stays exactly as-is; human gets an email.
          await sendEmail({
            to: notifyEmail,
            subject: `Budget increase recommended for "${campaign.name}"`,
            text:
              `The optimizer recommends increasing budget. Reason: ${a.reason}. ` +
              `Current budget remains unchanged at $${(campaign.budgetCents / 100).toFixed(2)} (${campaign.budgetType}). ` +
              `Approve manually in Meta Ads Manager if you agree.`,
            campaignId,
            alertType: "BUDGET_RECOMMENDATION",
          });
          executed.push(`Budget recommendation emailed (no change made): ${a.reason}`);
          break;
      }
    } catch (err) {
      await log("OPTIMIZER", `Action ${a.action} on ${a.targetId} failed: ${(err as Error).message}`, {
        campaignId,
        level: "ERROR",
      });
    }
  }

  // INSIGHT REQUESTS: questions only the human can answer from real-world
  // operations (response speed, availability, pricing shifts). Cap at 2,
  // dedupe against open requests so the same question doesn't pile up daily.
  const insightRequests: { question: string; why: string }[] = [];
  const rawRequests = (result.insightRequests ?? []).slice(0, 2);
  if (rawRequests.length > 0) {
    const openRequests = await prisma.alert.findMany({
      where: { campaignId, type: "INSIGHT_REQUEST", acknowledged: false },
      select: { message: true },
    });
    for (const r of rawRequests) {
      if (typeof r?.question !== "string" || !r.question.trim()) continue;
      const question = r.question.trim().slice(0, 300);
      const why = typeof r.why === "string" ? r.why.trim().slice(0, 300) : "";
      // Crude dedupe: skip if an open request already shares the first 40 chars.
      const stem = question.slice(0, 40).toLowerCase();
      if (openRequests.some((o) => o.message.toLowerCase().includes(stem))) continue;
      await prisma.alert.create({
        data: {
          campaignId,
          type: "INSIGHT_REQUEST",
          message: `${question}${why ? ` — Why I'm asking: ${why}` : ""} (Answer by updating the strategy profile or Manager Directive.)`,
        },
      });
      insightRequests.push({ question, why });
    }
  }

  // DIRECTIVE DRIFT: the AI judged that the human's current steering can no
  // longer be honored by tuning — the campaign structure itself is wrong.
  // Surface it loudly (alert + email); never act on it autonomously.
  let relaunchReason: string | null = null;
  let relaunchIsNew = false;
  if (result.relaunch?.needed && typeof result.relaunch.reason === "string" && result.relaunch.reason.trim()) {
    relaunchReason = result.relaunch.reason.trim().slice(0, 300);
    const openRelaunch = await prisma.alert.findFirst({
      where: { campaignId, type: "RELAUNCH_RECOMMENDED", acknowledged: false },
    });
    if (!openRelaunch) {
      relaunchIsNew = true;
      await prisma.alert.create({
        data: {
          campaignId,
          type: "RELAUNCH_RECOMMENDED",
          message: `Your current direction has drifted from how this campaign was built: ${relaunchReason} Tuning can't fix this — consider rebuilding the campaign in the wizard to match today's goals.`,
        },
      });
    }
  }

  await log("OPTIMIZER", result.summary ?? "Cycle complete.", {
    campaignId,
    detail: { executed, blocked, insightRequests, relaunchReason },
  });

  // DAILY REPORT: email the business contact the metrics pull, the AI's
  // strategy-aware analysis, and every change made — inviting intervention.
  // Cadence honors the client's reportFrequency preference (busy people):
  // DAILY always, WEEKLY on Mondays, OFF never. Optimization itself, budget
  // recommendations, and drift alerts are never silenced by this setting.
  const frequency = campaign.client?.reportFrequency ?? "DAILY";
  const isMonday = new Date().getUTCDay() === 1;
  const cadenceDue = frequency === "DAILY" || (frequency === "WEEKLY" && isMonday);
  // A freshly-detected drift always informs the owner, even on OFF — it's a
  // consequential decision request, not a routine report. (Only on first
  // detection; the open alert prevents daily nagging.)
  const shouldEmail = cadenceDue || relaunchIsNew;
  if (shouldEmail) {
    await sendDailyReport({
      campaign,
      to: notifyEmail,
      day,
      metrics: { totalSpend, totalImpr, totalClicks, totalConv },
      aiSummary: result.summary,
      aiReport: result.report,
      executed,
      insightRequests,
      relaunchReason,
    });
  }

  return { executed, blocked };
}

async function sendDailyReport(args: {
  campaign: { id: string; name: string; budgetCents: number; budgetType: string; metaCampaignId: string | null };
  to: string;
  day: string;
  metrics: { totalSpend: number; totalImpr: number; totalClicks: number; totalConv: number };
  aiSummary?: string;
  aiReport?: string;
  executed: string[];
  insightRequests?: { question: string; why: string }[];
  relaunchReason?: string | null;
}): Promise<void> {
  const { campaign, to, day, metrics, aiSummary, aiReport, executed, insightRequests = [], relaunchReason } = args;
  const ctr = metrics.totalImpr > 0 ? ((metrics.totalClicks / metrics.totalImpr) * 100).toFixed(2) : "0.00";
  const cpa = metrics.totalConv > 0 ? `$${(metrics.totalSpend / metrics.totalConv).toFixed(2)}` : "—";
  const changes = executed.length ? executed.map((e) => `• ${e}`).join("\n") : "• No changes — performance is within normal range.";
  const relaunchBlockText = relaunchReason
    ? [
        ``,
        `⚠ YOUR DIRECTION HAS OUTGROWN THIS CAMPAIGN`,
        `${relaunchReason}`,
        `Day-to-day tuning can't get there from here — when you're ready, rebuild the campaign in the dashboard so its audience and objective match your current goals. Nothing has been changed without you.`,
      ]
    : [];
  const insightBlockText = insightRequests.length
    ? [
        ``,
        `I NEED YOUR EYES ON SOMETHING`,
        ...insightRequests.map((r) => `• ${r.question}${r.why ? `\n  (Why: ${r.why})` : ""}`),
        `Answer by updating your strategy profile or Manager Directive in the dashboard — it directly sharpens tomorrow's decisions.`,
      ]
    : [];

  const text = [
    `Daily report for "${campaign.name}" — ${day}`,
    ``,
    aiReport ?? aiSummary ?? "Your campaign was reviewed.",
    ``,
    `YESTERDAY'S NUMBERS`,
    `Spend: $${metrics.totalSpend.toFixed(2)} of $${(campaign.budgetCents / 100).toFixed(2)} ${campaign.budgetType.toLowerCase()} budget`,
    `Impressions: ${metrics.totalImpr.toLocaleString()}  |  Clicks: ${metrics.totalClicks}  |  CTR: ${ctr}%`,
    `Conversions: ${metrics.totalConv}  |  Cost per conversion: ${cpa}`,
    ``,
    `CHANGES MADE TODAY`,
    changes,
    ...relaunchBlockText,
    ...insightBlockText,
    ``,
    `Budget is never increased automatically — that always waits for your approval. Reply to this email with any questions or if you'd like to change direction.`,
    ``,
    `— Your AI media buyer`,
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5">
    <h2 style="margin:0 0 4px">Daily report — ${esc(campaign.name)}</h2>
    <p style="color:#666;margin:0 0 16px">${esc(day)}</p>
    <p>${esc(aiReport ?? aiSummary ?? "Your campaign was reviewed.").replace(/\n/g, "<br>")}</p>
    <h3 style="margin:20px 0 6px">Yesterday's numbers</h3>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Spend</td><td><b>$${metrics.totalSpend.toFixed(2)}</b> of $${(campaign.budgetCents / 100).toFixed(2)} ${campaign.budgetType.toLowerCase()}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Impressions</td><td>${metrics.totalImpr.toLocaleString()}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Clicks / CTR</td><td>${metrics.totalClicks} / ${ctr}%</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Conversions</td><td>${metrics.totalConv}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Cost / conversion</td><td>${cpa}</td></tr>
    </table>
    <h3 style="margin:20px 0 6px">Changes made today</h3>
    <ul style="margin:0;padding-left:18px">${executed.length ? executed.map((e) => `<li>${esc(e)}</li>`).join("") : "<li>No changes — performance within normal range.</li>"}</ul>
    ${
      relaunchReason
        ? `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px;margin:16px 0">
    <b>⚠ Your direction has outgrown this campaign.</b><br>${esc(relaunchReason)}<br>
    <span style="color:#666;font-size:13px">Day-to-day tuning can't get there from here — rebuild the campaign in the dashboard when ready. Nothing was changed without you.</span></div>`
        : ""
    }
    ${
      insightRequests.length
        ? `<h3 style="margin:20px 0 6px">🧭 I need your eyes on something</h3>
    <ul style="margin:0;padding-left:18px">${insightRequests.map((r) => `<li><b>${esc(r.question)}</b>${r.why ? `<br><span style="color:#666;font-size:13px">Why: ${esc(r.why)}</span>` : ""}</li>`).join("")}</ul>
    <p style="color:#666;font-size:13px;margin:6px 0 0">Answer by updating your strategy profile or Manager Directive in the dashboard — it directly sharpens tomorrow's decisions.</p>`
        : ""
    }
    <p style="color:#666;font-size:13px;margin-top:20px">Budget is never increased automatically — that always waits for your approval. Reply with any questions.</p>
    <p style="margin:4px 0 0">— Your AI media buyer</p>
  </div>`;

  await sendEmail({ to, subject: `📊 Daily ad report: ${campaign.name} (${day})`, text, html, campaignId: campaign.id });
}
