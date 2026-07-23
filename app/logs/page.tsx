import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LEVELS = ["ERROR", "WARN", "INFO"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_TONE: Record<Level, { wash: string; color: string }> = {
  ERROR: { wash: "var(--danger-wash)", color: "var(--danger)" },
  WARN: { wash: "var(--warning-wash)", color: "var(--warning)" },
  INFO: { wash: "var(--surface-3)", color: "var(--ink-tertiary)" },
};

/** Admin-only (also gated in middleware): recent app diagnostics from the Log
 * table, so incidents like a failing preflight can be triaged here instead of
 * pulling `vercel logs`. */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  const { level } = await searchParams;
  const activeLevel = LEVELS.includes(level as Level) ? (level as Level) : null;

  const logs = await prisma.log.findMany({
    where: activeLevel ? { level: activeLevel } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { campaign: { select: { id: true, name: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>
          Diagnostics log
        </h1>
        <div className="flex gap-1 text-sm font-medium">
          <Link
            href="/logs"
            className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors"
            style={
              !activeLevel
                ? { background: "var(--surface-3)", color: "var(--ink-primary)" }
                : { color: "var(--ink-tertiary)" }
            }
          >
            All
          </Link>
          {LEVELS.map((l) => (
            <Link
              key={l}
              href={`/logs?level=${l}`}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors"
              style={
                activeLevel === l
                  ? { background: LEVEL_TONE[l].wash, color: LEVEL_TONE[l].color }
                  : { color: "var(--ink-tertiary)" }
              }
            >
              {l}
            </Link>
          ))}
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] p-10 text-center" style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}>
          No log entries{activeLevel ? ` at level ${activeLevel}` : ""} yet.
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((l) => {
            const tone = LEVEL_TONE[(l.level as Level) ?? "INFO"] ?? LEVEL_TONE.INFO;
            return (
              <div
                key={l.id}
                className="rounded-[var(--radius-md)] p-4"
                style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ background: tone.wash, color: tone.color }}
                  >
                    {l.level}
                  </span>
                  <span className="text-xs font-medium" style={{ color: "var(--ink-tertiary)" }}>{l.source}</span>
                  {l.campaign && (
                    <Link
                      href={`/campaigns/${l.campaign.id}`}
                      className="text-xs underline underline-offset-2"
                      style={{ color: "var(--accent)" }}
                    >
                      {l.campaign.name}
                    </Link>
                  )}
                  <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                    {l.createdAt.toLocaleString()}
                  </span>
                </div>
                <p className="text-sm" style={{ color: "var(--ink-primary)" }}>{l.message}</p>
                {l.detailJson && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs" style={{ color: "var(--ink-tertiary)" }}>
                      Detail
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded-[var(--radius-sm)] p-2 text-xs" style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}>
                      {l.detailJson}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
