import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { StopButton } from "@/app/components/StopButton";
import { DirectiveEditor } from "./DirectiveEditor";
import type { CopilotPlan } from "@/lib/types";
import { getSession, canAccessCampaign } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await canAccessCampaign(session, id))) notFound();
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      snapshots: { orderBy: { date: "desc" }, take: 30 },
      logs: { orderBy: { createdAt: "desc" }, take: 30 },
      alerts: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!campaign) notFound();

  const plan = campaign.aiPlanJson ? (JSON.parse(campaign.aiPlanJson) as CopilotPlan) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
            {campaign.status} · ${(campaign.budgetCents / 100).toFixed(0)}{" "}
            {campaign.budgetType === "DAILY" ? "/day" : "lifetime"} · {campaign.durationDays} days
            {campaign.abTest && ` · A/B on ${campaign.abVariable?.toLowerCase()}`}
          </p>
          {campaign.lastError && <p className="mt-2 text-sm text-[var(--danger)]">⚠️ {campaign.lastError}</p>}
        </div>
        {(campaign.status === "ACTIVE" || campaign.status === "LAUNCHING") && (
          <StopButton campaignId={campaign.id} large />
        )}
      </div>

      {plan && (
        <section className="rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-5 text-sm">
          <h2 className="mb-2 font-medium text-[var(--ink-primary)]">AI Plan</h2>
          <p className="text-[var(--ink-secondary)]">{plan.rationale}</p>
          <p className="mt-2 text-[var(--ink-tertiary)]">
            {plan.adSets.length} ad set(s) · {plan.ads.length} ad(s) · Meta ID: {campaign.metaCampaignId ?? "not launched"}
          </p>
        </section>
      )}

      <DirectiveEditor
        campaignId={campaign.id}
        initialDirective={campaign.directive ?? ""}
        initialAbNotes={campaign.abNotes ?? ""}
        abTest={campaign.abTest}
        directiveAt={campaign.directiveAt ? campaign.directiveAt.toISOString() : null}
      />

      <section>
        <h2 className="mb-3 text-lg font-medium text-[var(--ink-primary)]">Daily Analytics</h2>
        {campaign.snapshots.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">No data yet — the daily cron populates this after the first cycle.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--line-subtle)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-1)] text-left text-[var(--ink-tertiary)]">
                <tr>
                  <th className="px-4 py-2">Date</th><th className="px-4 py-2">Spend</th>
                  <th className="px-4 py-2">Impressions</th><th className="px-4 py-2">Clicks</th>
                  <th className="px-4 py-2">CTR</th><th className="px-4 py-2">Conv.</th><th className="px-4 py-2">CPA</th>
                </tr>
              </thead>
              <tbody>
                {campaign.snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line-subtle)] tabular-nums">
                    <td className="px-4 py-2">{s.date}</td>
                    <td className="px-4 py-2">${(s.spendCents / 100).toFixed(2)}</td>
                    <td className="px-4 py-2">{s.impressions.toLocaleString()}</td>
                    <td className="px-4 py-2">{s.clicks}</td>
                    <td className="px-4 py-2">{s.ctr.toFixed(2)}%</td>
                    <td className="px-4 py-2">{s.conversions}</td>
                    <td className="px-4 py-2">{s.cpaCents ? `$${(s.cpaCents / 100).toFixed(2)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-[var(--ink-primary)]">Activity Log</h2>
        <div className="space-y-1.5 text-sm">
          {campaign.logs.map((l) => (
            <div key={l.id} className="flex gap-3 rounded-lg bg-[var(--surface-1)] px-3 py-2">
              <span className="shrink-0 text-xs text-[var(--ink-muted)]">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span className={`shrink-0 text-xs font-medium ${l.level === "ERROR" ? "text-[var(--danger)]" : l.level === "WARN" ? "text-[var(--warning)]" : "text-[var(--ink-tertiary)]"}`}>
                [{l.source}]
              </span>
              <span className="text-[var(--ink-primary)]">{l.message}</span>
            </div>
          ))}
          {campaign.logs.length === 0 && <p className="text-[var(--ink-muted)]">No activity yet.</p>}
        </div>
      </section>
    </div>
  );
}
