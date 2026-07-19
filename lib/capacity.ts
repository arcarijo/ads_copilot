import { prisma } from "./db";
import { EDGE_MODEL, SMART_MODEL } from "./ai";

// ---- Configurable ceilings ----
// Cloudflare Workers AI's free allocation is measured in "neurons," a unit
// that varies by model and token count with no simple public API to query
// remaining balance. Rather than fabricate precise neuron math, we track our
// own REQUEST COUNT as an honest, conservative trip-wire — tune via env vars
// as the real account's behavior becomes clear.
const MAX_AI_CALLS_PER_DAY = Number(process.env.CAPACITY_MAX_AI_CALLS_PER_DAY ?? 250);
// Supabase free-tier project storage cap (bytes). 500 MB as of this writing.
const MAX_DB_BYTES = Number(process.env.CAPACITY_MAX_DB_BYTES ?? 500 * 1024 * 1024);
// Practical portfolio-wide research ceiling: research.ts already caps each
// client at 5 runs/day; this is a soft signal for when many clients combine.
const RESEARCH_SOFT_CEILING = Number(process.env.CAPACITY_RESEARCH_SOFT_CEILING ?? 40);

export type CapacityTone = "success" | "warning" | "danger";

export interface CapacityMetric {
  key: string;
  label: string;
  used: number;
  cap: number;
  pct: number; // 0-100, clamped
  tone: CapacityTone;
  detail: string;
}

function toneFor(pct: number): CapacityTone {
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warning";
  return "success";
}

export interface CapacitySnapshot {
  metrics: CapacityMetric[];
  worstTone: CapacityTone;
  generatedAt: string;
  activeCampaigns: number;
  clientCount: number;
}

export async function getCapacitySnapshot(): Promise<CapacitySnapshot> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [aiCalls, smartCalls, researchToday, dbSizeRow, activeCampaigns, clientCount] = await Promise.all([
    prisma.usageEvent.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.usageEvent.count({ where: { createdAt: { gte: dayAgo }, model: SMART_MODEL } }),
    prisma.researchRun.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.$queryRawUnsafe<{ bytes: bigint }[]>("SELECT pg_database_size(current_database()) AS bytes").catch(() => null),
    prisma.campaign.count({ where: { status: { in: ["ACTIVE", "LAUNCHING"] } } }),
    prisma.client.count(),
  ]);

  const edgeCalls = aiCalls - smartCalls;
  const dbBytes = dbSizeRow?.[0]?.bytes ? Number(dbSizeRow[0].bytes) : null;

  const metrics: CapacityMetric[] = [];

  const aiPct = Math.min(100, (aiCalls / MAX_AI_CALLS_PER_DAY) * 100);
  metrics.push({
    key: "ai-calls",
    label: "AI calls (24h)",
    used: aiCalls,
    cap: MAX_AI_CALLS_PER_DAY,
    pct: aiPct,
    tone: toneFor(aiPct),
    detail: `${smartCalls} smart (${SMART_MODEL.split("/").pop()}) · ${edgeCalls} edge (${EDGE_MODEL.split("/").pop()}) — heavier model, watch this split first`,
  });

  if (dbBytes !== null) {
    const dbPct = Math.min(100, (dbBytes / MAX_DB_BYTES) * 100);
    metrics.push({
      key: "db-size",
      label: "Database size",
      used: Math.round(dbBytes / (1024 * 1024)),
      cap: Math.round(MAX_DB_BYTES / (1024 * 1024)),
      pct: dbPct,
      tone: toneFor(dbPct),
      detail: `${(dbBytes / (1024 * 1024)).toFixed(1)} MB of ${(MAX_DB_BYTES / (1024 * 1024)).toFixed(0)} MB Supabase free-tier cap`,
    });
  }

  const researchPct = Math.min(100, (researchToday / RESEARCH_SOFT_CEILING) * 100);
  metrics.push({
    key: "research-runs",
    label: "Research runs (24h)",
    used: researchToday,
    cap: RESEARCH_SOFT_CEILING,
    pct: researchPct,
    tone: toneFor(researchPct),
    detail: `Across all clients · each client is separately capped at 5/day`,
  });

  const worstTone: CapacityTone = metrics.some((m) => m.tone === "danger")
    ? "danger"
    : metrics.some((m) => m.tone === "warning")
      ? "warning"
      : "success";

  return { metrics, worstTone, generatedAt: new Date().toISOString(), activeCampaigns, clientCount };
}
