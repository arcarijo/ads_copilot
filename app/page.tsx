import Link from "next/link";
import type { CSSProperties } from "react";
import { prisma } from "@/lib/db";
import { StopButton } from "./components/StopButton";
import { AlertBanner } from "./components/AlertBanner";
import { CapacityBar } from "./components/CapacityBar";
import { Icon } from "./components/Icon";
import { getCapacitySnapshot } from "@/lib/capacity";
import { getCoachTips } from "@/lib/coach";
import { getSession, campaignScope, clientScope } from "@/lib/auth";
import { redirect } from "next/navigation";

// Stagger helper: sets the --i custom prop the .rise-in keyframe reads.
const stagger = (i: number, extra?: CSSProperties): CSSProperties => ({ ["--i" as string]: i, ...extra } as CSSProperties);

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; wash: string; dot: string }> = {
  ACTIVE: { label: "Active", wash: "var(--success-wash)", dot: "var(--success)" },
  READY: { label: "Ready", wash: "var(--info-wash)", dot: "var(--info)" },
  NEEDS_CLARIFICATION: { label: "Needs input", wash: "var(--warning-wash)", dot: "var(--warning)" },
  DRAFT: { label: "Draft", wash: "var(--surface-3)", dot: "var(--ink-muted)" },
  PAUSED: { label: "Paused", wash: "var(--warning-wash)", dot: "var(--warning)" },
  STOPPED: { label: "Stopped", wash: "var(--danger-wash)", dot: "var(--danger)" },
  ERROR: { label: "Error", wash: "var(--danger-wash)", dot: "var(--danger)" },
  LAUNCHING: { label: "Launching", wash: "var(--info-wash)", dot: "var(--info)" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.DRAFT;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: s.wash, color: "var(--ink-primary)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} aria-hidden />
      {s.label}
    </span>
  );
}

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = session.role === "admin";

  const [campaigns, alerts, capacity, coachTips] = await Promise.all([
    prisma.campaign.findMany({
      where: campaignScope(session),
      orderBy: { createdAt: "desc" },
      include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
    }),
    prisma.alert.findMany({
      where: {
        acknowledged: false,
        // Users see alerts on their own campaigns; system-wide (no-campaign)
        // alerts are the admin's problem, not the client's.
        ...(admin ? {} : { campaign: { client: { userId: session.userId } } }),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    admin ? getCapacitySnapshot() : Promise.resolve(null),
    getCoachTips(clientScope(session)),
  ]);

  const latest = campaigns.map((c) => c.snapshots[0]).filter(Boolean);
  const totalSpend = latest.reduce((s, x) => s + x.spendCents, 0) / 100;
  const totalBudget = campaigns.reduce((s, c) => s + c.budgetCents, 0) / 100;
  const totalClicks = latest.reduce((s, x) => s + x.clicks, 0);
  const totalImpr = latest.reduce((s, x) => s + x.impressions, 0);
  const totalConv = latest.reduce((s, x) => s + x.conversions, 0);
  const blendedCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
  const blendedCpa = totalConv > 0 ? totalSpend / totalConv : 0;
  const activeCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const needsAttention = campaigns.filter((c) => ["NEEDS_CLARIFICATION", "ERROR", "PAUSED"].includes(c.status)).length;
  const budgetUsedPct = totalBudget > 0 ? Math.min(100, (totalSpend / totalBudget) * 100) : 0;

  return (
    <div className="space-y-8">
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <AlertBanner key={a.id} id={a.id} type={a.type} message={a.message} />
          ))}
        </div>
      )}

      {/* Hero: the one committed-color moment on this screen. Full gradient
          wash, huge numeral — everything else on the page stays neutral so
          this is unmistakably the focal point. */}
      <section
        className="rise-in overflow-hidden rounded-[var(--radius-lg)] p-7 sm:p-8"
        style={stagger(0, { background: "var(--hero-gradient)" })}
      >
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>
              {needsAttention > 0
                ? `${needsAttention} campaign${needsAttention > 1 ? "s" : ""} need${needsAttention === 1 ? "s" : ""} your attention`
                : "Portfolio running smoothly"}
            </p>
            <div className="text-hero mt-1 text-white" style={{ fontSize: "clamp(3.5rem, 9vw, 6rem)" }}>
              {activeCount}
            </div>
            <p className="mt-1 text-sm font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>
              active campaign{activeCount === 1 ? "" : "s"}
            </p>
          </div>

          {/* Secondary metrics — demoted: smaller, translucent-white, no competing weight */}
          <div className="grid w-full grid-cols-2 gap-4 sm:w-auto sm:grid-cols-4 sm:gap-6">
            {[
              { label: "Spend yesterday", value: `$${totalSpend.toFixed(2)}` },
              { label: "Budget used", value: `${budgetUsedPct.toFixed(0)}%` },
              { label: "Blended CTR", value: totalImpr > 0 ? `${blendedCtr.toFixed(2)}%` : "—" },
              { label: "Blended CPA", value: totalConv > 0 ? `$${blendedCpa.toFixed(2)}` : "—" },
            ].map((t) => (
              <div key={t.label} className="min-w-[6rem]">
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.65)" }}>
                  {t.label}
                </div>
                <div className="font-display tabular-nums mt-0.5 text-xl font-bold text-white">{t.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* System capacity — self-tracked trip-wire against free-tier limits.
          Admin-only: infrastructure health is the operator's concern. */}
      {capacity && (
        <section
          className="rise-in rounded-[var(--radius-md)] p-4"
          style={stagger(1, {
            background: capacity.worstTone === "success" ? "var(--surface-1)" : "var(--warning-wash)",
            border: capacity.worstTone === "danger" ? "1px solid rgba(251,113,133,0.3)" : capacity.worstTone === "warning" ? "1px solid rgba(251,191,36,0.25)" : "1px solid var(--line-subtle)",
          })}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>
              System Capacity
            </h2>
            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
              {capacity.clientCount} client{capacity.clientCount === 1 ? "" : "s"} · {capacity.activeCampaigns} active campaign{capacity.activeCampaigns === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {capacity.metrics.map((m) => (
              <CapacityBar key={m.key} metric={m} />
            ))}
          </div>
          {capacity.worstTone !== "success" && (
            <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--warning)" }}>
              <Icon name="alert" size="0.9rem" />
              {capacity.worstTone === "danger"
                ? "At least one free-tier limit is nearly exhausted — upgrade the affected service before adding more clients."
                : "Approaching a free-tier limit — worth watching before onboarding more clients."}
            </p>
          )}
        </section>
      )}

      {/* Promoter's Coach — the Co-Pilot voice (coral wash block) teaching a
          non-expert operator what a senior promoter would check today. Rule-
          based (lib/coach.ts): profile depth, directive hygiene, performance
          vs 2026 events-industry benchmarks. */}
      {coachTips.length > 0 && (
        <section
          className="rise-in rounded-[var(--radius-lg)] p-5"
          style={stagger(2, { background: "var(--accent-wash)", border: "1px solid var(--accent-ring)" })}
        >
          <div className="mb-1 flex items-center gap-2" style={{ color: "var(--accent)" }}>
            <Icon name="compass" size="1.15rem" />
            <h2 className="font-display text-base font-semibold" style={{ color: "var(--ink-primary)" }}>
              Promoter&apos;s Coach
            </h2>
          </div>
          <p className="mb-4 text-xs" style={{ color: "var(--ink-tertiary)" }}>
            What a senior events promoter would look at today — and what your co-pilot can&apos;t see without you.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {coachTips.map((tip, i) => (
              <Link
                key={i}
                href={tip.href}
                className="rise-in lift group flex flex-col rounded-[var(--radius-md)] p-4"
                style={stagger(i + 3, { background: "var(--surface-1)", border: "1px solid var(--line-subtle)" })}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={
                      tip.severity === "act"
                        ? { background: "var(--warning-wash)", color: "var(--warning)" }
                        : { background: "var(--surface-3)", color: "var(--ink-tertiary)" }
                    }
                  >
                    {tip.severity === "act" ? "Act on this" : "Worth considering"}
                  </span>
                  {tip.clientName && (
                    <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>{tip.clientName}</span>
                  )}
                </div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>
                  {tip.title}
                  <Icon name="arrow-right" size="0.85rem" className="icon-nudge" style={{ color: "var(--accent)" }} />
                </h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{tip.body}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rise-in" style={stagger(3)}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>
          Campaigns
        </h2>
        {campaigns.length === 0 ? (
          <div
            className="rounded-[var(--radius-lg)] p-10 text-center"
            style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}
          >
            No campaigns yet.{" "}
            <Link href="/new" style={{ color: "var(--accent)" }} className="underline underline-offset-2">
              Create your first one
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c, i) => {
              const s = c.snapshots[0];
              return (
                <div
                  key={c.id}
                  className="rise-in lift grid grid-cols-2 items-center gap-3 rounded-[var(--radius-md)] p-4 sm:grid-cols-6"
                  style={stagger(i + 4, { background: "var(--surface-1)", border: "1px solid var(--line-subtle)" })}
                >
                  <div className="col-span-2 sm:col-span-2">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="font-display font-medium transition-colors hover:text-[var(--accent)]"
                      style={{ color: "var(--ink-primary)" }}
                    >
                      {c.name}
                    </Link>
                    <div className="mt-1"><StatusPill status={c.status} /></div>
                  </div>
                  <div className="text-sm">
                    <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>Budget</div>
                    <div className="tabular-nums" style={{ color: "var(--ink-secondary)" }}>
                      ${(c.budgetCents / 100).toFixed(0)} {c.budgetType === "DAILY" ? "/day" : "total"}
                    </div>
                  </div>
                  <div className="text-sm">
                    <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>Spend</div>
                    <div className="tabular-nums" style={{ color: "var(--ink-secondary)" }}>{s ? `$${(s.spendCents / 100).toFixed(2)}` : "—"}</div>
                  </div>
                  <div className="text-sm">
                    <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>CTR / CPA</div>
                    <div className="tabular-nums" style={{ color: "var(--ink-secondary)" }}>
                      {s ? `${s.ctr.toFixed(2)}%` : "—"} · {s?.cpaCents ? `$${(s.cpaCents / 100).toFixed(2)}` : "—"}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    {(c.status === "ACTIVE" || c.status === "LAUNCHING") && <StopButton campaignId={c.id} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
