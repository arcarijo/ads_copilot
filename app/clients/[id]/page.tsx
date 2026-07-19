import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { VerifyCheck } from "@/lib/meta";
import { Sections, sectionsFromLegacyMd } from "@/lib/profile";
import { getSession, canAccessClient } from "@/lib/auth";
import { ClientManager } from "./ClientManager";
import { AudienceStudio } from "./AudienceStudio";

export const dynamic = "force-dynamic";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await canAccessClient(session, id))) notFound();
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      profile: true,
      campaigns: { orderBy: { createdAt: "desc" } },
      researchRuns: { orderBy: { createdAt: "desc" }, take: 10 },
      platforms: true,
      audiences: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!client) notFound();

  const verify = client.verifyResultJson
    ? (JSON.parse(client.verifyResultJson) as { ready: boolean; checks: VerifyCheck[] })
    : null;
  const markets = client.profile ? (JSON.parse(client.profile.marketsJson) as string[]) : [];
  const socialLinks = (() => {
    try {
      return JSON.parse(client.socialLinksJson) as string[];
    } catch {
      return [];
    }
  })();
  const sections: Sections = (() => {
    if (!client.profile) return {};
    try {
      const s = JSON.parse(client.profile.sectionsJson) as Sections;
      if (s && Object.keys(s).length) return s;
    } catch {
      /* fall through */
    }
    return sectionsFromLegacyMd(client.profile.profileMd);
  })();

  return (
    <div className="space-y-8">
      <ClientManager
        id={client.id}
        name={client.name}
        contactEmail={client.contactEmail}
        website={client.website}
        gmbUrl={client.gmbUrl}
        socialLinks={socialLinks}
        metaAdAccountId={client.metaAdAccountId}
        metaPageId={client.metaPageId}
        status={client.status}
        verify={verify}
        profileMd={client.profile?.profileMd ?? null}
        profileVersion={client.profile?.version ?? null}
        markets={markets}
        sections={sections}
        directive={client.profile?.directive ?? ""}
        directiveAt={client.profile?.directiveAt ? client.profile.directiveAt.toISOString() : null}
        isAdmin={session.role === "admin"}
        reportFrequency={client.reportFrequency}
        platforms={client.platforms.map((p) => ({
          platform: p.platform,
          enabled: p.enabled,
          status: p.status,
          directive: p.directive,
          directiveAt: p.directiveAt ? p.directiveAt.toISOString() : null,
        }))}
      />

      <AudienceStudio
        clientId={client.id}
        audiences={client.audiences.map((a) => ({
          id: a.id,
          kind: a.kind,
          name: a.name,
          metaAudienceId: a.metaAudienceId,
          sourceNote: a.sourceNote,
          createdAt: a.createdAt.toISOString().slice(0, 10),
        }))}
      />

      <section>
        <h2 className="mb-3 text-lg font-medium text-[var(--ink-primary)]">Research History</h2>
        <div className="space-y-1.5 text-sm">
          {client.researchRuns.map((r) => (
            <div key={r.id} className="flex gap-3 rounded-lg bg-[var(--surface-1)] px-3 py-2">
              <span className="shrink-0 text-xs text-[var(--ink-muted)]">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              <span className="shrink-0 text-xs font-medium text-[var(--ink-tertiary)]">[{r.type}]</span>
              <span className={`shrink-0 text-xs ${r.status === "DONE" ? "text-[var(--success)]" : r.status === "FAILED" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>{r.status}</span>
              <span className="text-[var(--ink-secondary)]">{r.summary ?? r.trigger} ({r.pagesFetched} pages)</span>
            </div>
          ))}
          {client.researchRuns.length === 0 && <p className="text-[var(--ink-muted)]">No research runs yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-[var(--ink-primary)]">Campaigns</h2>
        {client.campaigns.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">
            None yet. <Link href="/new" className="text-[var(--accent)] underline">Create one</Link>.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {client.campaigns.map((c) => (
              <li key={c.id} className="rounded-lg bg-[var(--surface-1)] px-3 py-2">
                <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-[var(--success)]">{c.name}</Link>
                <span className="ml-2 text-[var(--ink-tertiary)]">{c.status} · ${(c.budgetCents / 100).toFixed(0)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
