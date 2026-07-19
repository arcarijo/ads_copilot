import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, clientScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, { wash: string; color: string }> = {
  VERIFIED: { wash: "var(--success-wash)", color: "var(--success)" },
  PENDING: { wash: "var(--warning-wash)", color: "var(--warning)" },
  ERROR: { wash: "var(--danger-wash)", color: "var(--danger)" },
};

export default async function Clients() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = session.role === "admin";
  const clients = await prisma.client.findMany({
    where: clientScope(session),
    orderBy: { createdAt: "desc" },
    include: { profile: { select: { version: true } }, _count: { select: { campaigns: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>
          {admin ? "Clients" : "Your Businesses"}
        </h1>
        {admin && (
          <Link
            href="/clients/new"
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[#1a0f08] transition-transform active:scale-[0.97]"
            style={{ background: "var(--accent)" }}
          >
            + Onboard Client
          </Link>
        )}
      </div>

      {clients.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] p-10 text-center" style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}>
          No clients yet.{" "}
          <Link href="/clients/new" className="underline underline-offset-2" style={{ color: "var(--accent)" }}>Onboard your first client</Link>.
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
