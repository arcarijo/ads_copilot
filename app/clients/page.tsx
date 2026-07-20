import Link from "next/link";
import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, clientScope } from "@/lib/auth";
import { getCoachTips } from "@/lib/coach";
import { Icon } from "../components/Icon";

export const dynamic = "force-dynamic";

const stagger = (i: number, extra?: CSSProperties): CSSProperties => ({ ["--i" as string]: i, ...extra } as CSSProperties);

const STATUS_TONE: Record<string, { wash: string; color: string }> = {
  VERIFIED: { wash: "var(--success-wash)", color: "var(--success)" },
  PENDING: { wash: "var(--warning-wash)", color: "var(--warning)" },
  ERROR: { wash: "var(--danger-wash)", color: "var(--danger)" },
};

export default async function Clients() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = session.role === "admin";
  const [clients, coachTips] = await Promise.all([
    prisma.client.findMany({
      where: clientScope(session),
      orderBy: { createdAt: "desc" },
      include: { profile: { select: { version: true } }, _count: { select: { campaigns: true } } },
    }),
    getCoachTips(clientScope(session)),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>
          Ad accounts
        </h1>
        {admin && (
          <Link
            href="/clients/new"
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[#1a0f08] transition-transform active:scale-[0.97]"
            style={{ background: "var(--accent)" }}
          >
            + Onboard client
          </Link>
        )}
      </div>

      {/* Promoter's Coach — the Co-Pilot voice (coral wash block) teaching a
          non-expert operator what a senior promoter would check today. Rule-
          based (lib/coach.ts): profile depth, directive hygiene, performance
          vs 2026 events-industry benchmarks. Lives on the accounts page so it
          sits next to the businesses it's coaching. */}
      {coachTips.length > 0 && (
        <section
          className="rise-in rounded-[var(--radius-lg)] p-5"
          style={stagger(1, { background: "var(--accent-wash)", border: "1px solid var(--accent-ring)" })}
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
                style={stagger(i + 2, { background: "var(--surface-1)", border: "1px solid var(--line-subtle)" })}
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

      {clients.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] p-10 text-center" style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}>
          {admin ? (
            <>
              No ad accounts yet.{" "}
              <Link href="/clients/new" className="underline underline-offset-2" style={{ color: "var(--accent)" }}>Onboard your first client</Link>.
            </>
          ) : (
            "No ad accounts assigned to you yet — your account manager will set these up."
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => {
            const tone = STATUS_TONE[c.status] ?? STATUS_TONE.PENDING;
            return (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="grid grid-cols-2 items-center gap-3 rounded-[var(--radius-md)] p-4 transition-colors sm:grid-cols-5"
                style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}
              >
                <div className="col-span-2 sm:col-span-2">
                  <div className="font-display font-medium transition-colors" style={{ color: "var(--ink-primary)" }}>{c.name}</div>
                  <div className="text-xs" style={{ color: "var(--ink-muted)" }}>{c.contactEmail ?? "no email"}</div>
                </div>
                <div>
                  <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: tone.wash, color: tone.color }}>
                    {c.status}
                  </span>
                </div>
                <div className="text-sm" style={{ color: c.profile ? "var(--ink-secondary)" : "var(--warning)" }}>
                  {c.profile ? `v${c.profile.version}` : "not built"}
                </div>
                <div className="tabular-nums text-sm" style={{ color: "var(--ink-secondary)" }}>
                  {c._count.campaigns} campaign{c._count.campaigns === 1 ? "" : "s"}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
