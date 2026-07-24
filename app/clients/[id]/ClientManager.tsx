"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { VerifyCheck } from "@/lib/meta";
import {
  CATEGORY_META,
  PROFILE_SECTIONS,
  Sections,
  computeGaps,
  isGap,
  sectionToLines,
  linesToSection,
} from "@/lib/profile";
import { PlatformsPanel, PlatformRow } from "./PlatformsPanel";
import { Icon } from "../../components/Icon";

const inputCls =
  "w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm outline-none transition-colors focus:ring-1";
const inputStyle = { background: "var(--surface-inset)", border: "1px solid var(--line-standard)", color: "var(--ink-primary)" };
const labelCls = "mb-1 block text-xs font-medium";

// Priority drives BOTH card order and color: crucial (red) first, important
// (yellow) next, nice-to-have (blue) last. This tells owners at a glance what
// the daily ad checks weigh most.
const PRIORITY_META: Record<string, { rank: number; label: string; color: string; wash: string; border: string }> = {
  critical: { rank: 0, label: "Crucial", color: "var(--danger)", wash: "var(--danger-wash)", border: "rgba(251,113,133,0.4)" },
  important: { rank: 1, label: "Important", color: "var(--warning)", wash: "var(--warning-wash)", border: "rgba(251,191,36,0.4)" },
  nice: { rank: 2, label: "Nice to have", color: "var(--info)", wash: "var(--info-wash)", border: "rgba(125,211,252,0.4)" },
};

const ORDERED_SECTIONS = [...PROFILE_SECTIONS].sort(
  (a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank
);

export interface ClientManagerProps {
  id: string;
  name: string;
  contactEmail: string | null;
  website: string | null;
  gmbUrl: string | null;
  socialLinks: string[];
  metaAdAccountId: string;
  metaPageId: string;
  status: string;
  verify: { ready: boolean; checks: VerifyCheck[]; checkedAt?: string } | null;
  profileMd: string | null;
  profileVersion: number | null;
  markets: string[];
  sections: Sections;
  directive: string;
  directiveAt: string | null;
  isAdmin: boolean;
  reportFrequency: string;
  platforms: PlatformRow[];
}

const REPORT_OPTIONS = [
  { value: "DAILY", label: "Daily", blurb: "A report every morning" },
  { value: "WEEKLY", label: "Weekly", blurb: "One Monday digest" },
  { value: "OFF", label: "Off", blurb: "Only urgent decisions" },
];

export function ClientManager(p: ClientManagerProps) {
  const router = useRouter();

  // ---- Client info editing ----
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteClient() {
    if (!confirm(`Delete "${p.name}" and all of its campaigns, alerts, and profile? This cannot be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/clients/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/clients");
      router.refresh();
    } else {
      setDeleting(false);
      alert("Delete failed. Please try again.");
    }
  }
  const [info, setInfo] = useState({
    name: p.name,
    contactEmail: p.contactEmail ?? "",
    website: p.website ?? "",
    gmbUrl: p.gmbUrl ?? "",
    socialLinks: p.socialLinks.join("\n"),
  });
  const [savingInfo, setSavingInfo] = useState(false);

  async function saveInfo() {
    setSavingInfo(true);
    await fetch(`/api/clients/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...info, socialLinks: info.socialLinks.split("\n") }),
    });
    setSavingInfo(false);
    setEditing(false);
    router.refresh();
  }

  // Credential readiness now lives inside the Meta card in PlatformsPanel.

  // ---- Manager directive (steers the daily optimizer) ----
  const [directiveDraft, setDirectiveDraft] = useState(p.directive);
  const [savingDirective, setSavingDirective] = useState(false);
  const directiveDirty = directiveDraft.trim() !== p.directive.trim();

  async function saveDirective() {
    setSavingDirective(true);
    await fetch(`/api/clients/${p.id}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directive: directiveDraft }),
    });
    setSavingDirective(false);
    router.refresh();
  }

  // ---- Report cadence (busy owners pick how often they hear from us) ----
  const [frequency, setFrequency] = useState(p.reportFrequency);
  const [savingFrequency, setSavingFrequency] = useState(false);

  async function saveFrequency(value: string) {
    setFrequency(value);
    setSavingFrequency(true);
    await fetch(`/api/clients/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportFrequency: value }),
    });
    setSavingFrequency(false);
    router.refresh();
  }

  // ---- Strategy sections: ordered line-item editing (Notion-style).
  // Item order IS priority — the daily optimizer weighs top lines hardest. ----
  const [editKey, setEditKey] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [newLine, setNewLine] = useState("");
  const [savingSection, setSavingSection] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [checking2, setChecking2] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    verdict: string;
    summary: string;
    warnings: { missing: string; why: string; example: string }[];
  } | null>(null);

  function startEdit(key: string) {
    setEditKey(key);
    setLines(sectionToLines(p.sections[key]));
    setNewLine("");
    setCheckResult(null);
  }

  // Deep-link from the Promoter's Coach: /clients/[id]#strategy-<key> scrolls
  // to the section, flashes a highlight ring, and opens it for editing so a
  // non-expert lands exactly on the field the advice was about.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    const m = hash.match(/^#strategy-([a-z]+)$/i);
    if (!m) return;
    const key = m[1];
    if (!PROFILE_SECTIONS.some((s) => s.key === key)) return;
    setFocusKey(key);
    startEdit(key);
    const el = document.getElementById(`strategy-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusKey(null), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitNewLine() {
    if (!newLine.trim()) return;
    setLines((ls) => [...ls, newLine.trim()]);
    setNewLine("");
  }

  function moveLine(from: number, to: number) {
    setLines((ls) => {
      if (to < 0 || to >= ls.length) return ls;
      const next = [...ls];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function saveSection() {
    if (!editKey) return;
    setSavingSection(true);
    const content = linesToSection(newLine.trim() ? [...lines, newLine.trim()] : lines);
    await fetch(`/api/clients/${p.id}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: { [editKey]: content } }),
    });
    setSavingSection(false);
    setEditKey(null);
    router.refresh();
  }

  // "Check my work": AI reviews the draft for knowledge gaps — warns only,
  // never changes a line.
  async function checkMyWork() {
    if (!editKey) return;
    setChecking2(true);
    setCheckResult(null);
    const content = linesToSection(newLine.trim() ? [...lines, newLine.trim()] : lines);
    const res = await fetch(`/api/clients/${p.id}/profile/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionKey: editKey, content }),
    });
    const json = await res.json().catch(() => null);
    setChecking2(false);
    if (!res.ok || !json) {
      setCheckResult({ verdict: "error", summary: json?.error ?? "The check couldn't run — try again in a moment.", warnings: [] });
      return;
    }
    setCheckResult(json);
  }

  // ---- Optional: seed from web (a starting point, not the source of truth) ----
  const [showWeb, setShowWeb] = useState(false);
  const [busyWeb, setBusyWeb] = useState(false);
  const [webMsg, setWebMsg] = useState<string | null>(null);
  const [sources, setSources] = useState({
    website: p.website ?? "",
    gmbUrl: p.gmbUrl ?? "",
    socialLinks: p.socialLinks.join("\n"),
    extraUrls: "",
  });

  const gaps = useMemo(() => computeGaps(p.sections), [p.sections]);
  const hasProfile = Object.values(p.sections).some((v) => !isGap(v));
  const filledCount = PROFILE_SECTIONS.filter((s) => !isGap(p.sections[s.key])).length;

  async function seedFromWeb() {
    const anySource = sources.website.trim() || sources.gmbUrl.trim() || sources.socialLinks.trim() || sources.extraUrls.trim();
    if (!anySource) {
      setWebMsg("Add at least one URL first.");
      return;
    }
    setBusyWeb(true);
    setWebMsg("Scraping and enriching — your edits and directive are never overwritten…");
    const res = await fetch(`/api/clients/${p.id}/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger: hasProfile ? "manual-enrich" : "manual-seed",
        sources: { website: sources.website, gmbUrl: sources.gmbUrl, socialLinks: sources.socialLinks.split("\n") },
        extraUrls: sources.extraUrls.split("\n"),
      }),
    });
    const json = await res.json();
    setBusyWeb(false);
    setWebMsg(json.status === "DONE" ? (json.summary ?? "Seeded. Review and refine below.") : `${json.status}: ${json.summary ?? ""}`);
    router.refresh();
  }

  const statusTone =
    p.status === "VERIFIED" ? "var(--success)" : p.status === "ERROR" ? "var(--danger)" : "var(--warning)";

  const cardStyle = { background: "var(--surface-1)", border: "1px solid var(--line-subtle)" };

  return (
    <div className="space-y-6">
      {/* ---- Client identity ---- */}
      <div className="rounded-[var(--radius-lg)] p-5" style={cardStyle}>
        {!editing ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight" style={{ color: "var(--ink-primary)" }}>{p.name}</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--ink-tertiary)" }}>
                {p.contactEmail || <span style={{ color: "var(--warning)" }}>no email</span>} · act_{p.metaAdAccountId} · Page {p.metaPageId} ·{" "}
                <span style={{ color: statusTone }}>{p.status}</span>
              </p>
              {p.website && (
                <a href={p.website} className="text-sm hover:underline" style={{ color: "var(--info)" }} target="_blank" rel="noreferrer">{p.website}</a>
              )}
            </div>
            <button
              onClick={() => setEditing(true)}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
              style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
            >
              Edit details
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Business name</label><input className={inputCls} style={inputStyle} value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></div>
              <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Contact email</label><input className={inputCls} style={inputStyle} value={info.contactEmail} onChange={(e) => setInfo({ ...info, contactEmail: e.target.value })} placeholder="owner@business.com" /></div>
              <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Website</label><input className={inputCls} style={inputStyle} value={info.website} onChange={(e) => setInfo({ ...info, website: e.target.value })} /></div>
              <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Google Business link</label><input className={inputCls} style={inputStyle} value={info.gmbUrl} onChange={(e) => setInfo({ ...info, gmbUrl: e.target.value })} /></div>
            </div>
            <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Social links (one per line)</label><textarea className={inputCls} style={inputStyle} rows={2} value={info.socialLinks} onChange={(e) => setInfo({ ...info, socialLinks: e.target.value })} /></div>
            <div className="flex gap-2">
              <button
                onClick={saveInfo}
                disabled={savingInfo}
                className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {savingInfo ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="rounded-[var(--radius-sm)] px-4 py-2 text-sm" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Manager directive: steers the daily worker (the human's voice) ---- */}
      <section
        className="overflow-hidden rounded-[var(--radius-lg)] p-5"
        style={{ background: "var(--human-wash)", border: "1px solid rgba(167,139,250,0.25)" }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display flex items-center gap-2 text-base font-semibold" style={{ color: "var(--ink-primary)" }}>
              <Icon name="target" size="1.1rem" style={{ color: "var(--human)" }} /> Manager Directive
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-tertiary)" }}>
              Read <b>first</b> by your AI co-pilot each day. Tell it what changed in the business and how to steer the live campaign.
            </p>
          </div>
          {p.directiveAt && (() => {
            const ageDays = Math.floor((Date.now() - new Date(p.directiveAt).getTime()) / 86_400_000);
            const stale = p.directive.trim() && ageDays > 45;
            return (
              <span className="text-xs" style={{ color: stale ? "var(--warning)" : "var(--ink-muted)" }}>
                updated {p.directiveAt.slice(0, 10)}
                {stale ? ` — ${ageDays} days old. The AI still steers by this daily; refresh or clear it if the business has moved on.` : ""}
              </span>
            );
          })()}
        </div>
        <label htmlFor="directive" className="sr-only">Manager directive to the daily optimizer</label>
        <textarea
          id="directive"
          className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm outline-none transition-colors focus:ring-1"
          style={{ background: "var(--surface-inset)", border: "1px solid rgba(167,139,250,0.3)", color: "var(--ink-primary)" }}
          rows={3}
          value={directiveDraft}
          onChange={(e) => setDirectiveDraft(e.target.value)}
          placeholder="e.g. Corporate holiday bookings are our priority through December — favor corporate-event angles, wind down wedding creative, keep spend flat."
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={saveDirective}
            disabled={savingDirective || !directiveDirty}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#160e28] transition-transform active:scale-[0.97] disabled:opacity-40"
            style={{ background: "var(--human)" }}
          >
            {savingDirective ? "Saving…" : directiveDirty ? "Save directive" : "Saved"}
          </button>
          {directiveDraft.trim() && !directiveDirty && <span className="text-xs" style={{ color: "var(--success)" }}>✓ Active — your co-pilot will honor this on its next cycle.</span>}
          {!directiveDraft.trim() && <span className="text-xs" style={{ color: "var(--ink-muted)" }}>Empty = the AI follows the strategy sections only.</span>}
        </div>
      </section>

      {/* ---- Ad platforms: toggle, connect, steer per-platform (Meta card holds credential readiness) ---- */}
      <PlatformsPanel clientId={p.id} isAdmin={p.isAdmin} platforms={p.platforms} clientStatus={p.status} verify={p.verify} />

      {/* ---- Report cadence ---- */}
      <section className="rounded-[var(--radius-lg)] p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-medium" style={{ color: "var(--ink-primary)" }}>Email Reports</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
              How often the performance report lands in the inbox. Urgent items (budget approvals, campaign-rebuild recommendations) always come through regardless.
            </p>
          </div>
          <div className="flex gap-1 rounded-[var(--radius-sm)] p-1" style={{ background: "var(--surface-inset)" }} role="radiogroup" aria-label="Report frequency">
            {REPORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                role="radio"
                aria-checked={frequency === o.value}
                onClick={() => saveFrequency(o.value)}
                disabled={savingFrequency}
                title={o.blurb}
                className="rounded-[6px] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
                style={
                  frequency === o.value
                    ? { background: "var(--accent)", color: "#1a0f08" }
                    : { color: "var(--ink-tertiary)" }
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Strategy: priority-ordered, human-owned, at a glance ---- */}
      <section className="rounded-[var(--radius-lg)] p-5" style={cardStyle}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display font-medium" style={{ color: "var(--ink-primary)" }}>
            Marketing Strategy {p.profileVersion ? <span style={{ color: "var(--ink-muted)" }}>v{p.profileVersion}</span> : null}
          </h2>
          <div className="flex items-center gap-2">
            <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "var(--surface-3)", color: "var(--ink-tertiary)" }}>
              {filledCount}/{PROFILE_SECTIONS.length} filled
            </span>
            <button
              onClick={() => { setShowWeb((v) => !v); setWebMsg(null); }}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
            >
              {hasProfile ? "Seed more from web" : "Seed from web"}
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs" style={{ color: "var(--ink-muted)" }}>
          This is your ground truth. Your AI co-pilot reads every section on its daily cycle — edit any card to steer targeting and daily tweaks. Web research is only a starting point; your edits win.
        </p>

        {p.markets.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {p.markets.map((m) => (
              <span key={m} className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "var(--success-wash)", color: "var(--success)" }}>{m}</span>
            ))}
          </div>
        )}

        {gaps.length > 0 && (
          <div className="mb-4 rounded-[var(--radius-md)] p-3" style={{ background: "var(--warning-wash)", border: "1px solid rgba(251,191,36,0.25)" }}>
            <p className="text-sm" style={{ color: "var(--ink-primary)" }}>
              <b>{gaps.length} gap{gaps.length > 1 ? "s" : ""}</b> to fill for stronger targeting — the cards below marked{" "}
              <span style={{ color: "var(--warning)" }}>● gap</span> are empty or thin.
            </p>
          </div>
        )}

        {/* Optional web seeding */}
        {showWeb && (
          <div className="mb-5 space-y-3 rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--line-standard)" }}>
            <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>Scrape sources to <b>seed or enrich</b> the sections (max 5 pages, single pass). Never overwrites your manual edits or directive.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Website</label><input className={inputCls} style={inputStyle} value={sources.website} onChange={(e) => setSources({ ...sources, website: e.target.value })} placeholder="https://…" /></div>
              <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Google Business link</label><input className={inputCls} style={inputStyle} value={sources.gmbUrl} onChange={(e) => setSources({ ...sources, gmbUrl: e.target.value })} /></div>
            </div>
            <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Social links (one per line)</label><textarea className={inputCls} style={inputStyle} rows={2} value={sources.socialLinks} onChange={(e) => setSources({ ...sources, socialLinks: e.target.value })} /></div>
            <div><label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Additional URLs (one per line, this run only)</label><textarea className={inputCls} style={inputStyle} rows={2} value={sources.extraUrls} onChange={(e) => setSources({ ...sources, extraUrls: e.target.value })} /></div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={seedFromWeb}
                disabled={busyWeb}
                className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {busyWeb ? "Researching…" : "Scrape & seed"}
              </button>
              <button onClick={() => setShowWeb(false)} className="text-sm hover:underline" style={{ color: "var(--ink-muted)" }}>Close</button>
              {webMsg && <span className="text-sm" style={{ color: "var(--ink-secondary)" }}>{webMsg}</span>}
            </div>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>Limit: 5 research runs per client per day.</p>
          </div>
        )}

        {/* Strategy cards — priority-ordered (crucial→important→nice) and
            color-coded by priority so the daily-check weight reads instantly.
            Editing an item is a full-width span within the card, so cards flow
            single-column while editing for readable line items. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ORDERED_SECTIONS.map((def) => {
            const content = p.sections[def.key] ?? "";
            const gap = isGap(content);
            const pri = PRIORITY_META[def.priority];
            const isEditingThis = editKey === def.key;
            const isFocused = focusKey === def.key;
            return (
              <article
                key={def.key}
                id={`strategy-${def.key}`}
                className={`flex flex-col overflow-hidden rounded-[var(--radius-md)] transition-all ${isEditingThis ? "sm:col-span-2 xl:col-span-3" : ""}`}
                style={{
                  background: "var(--surface-2)",
                  border: `1px solid ${gap ? "rgba(251,191,36,0.35)" : "var(--line-subtle)"}`,
                  outline: isFocused ? `2px solid ${pri.color}` : "none",
                  outlineOffset: 2,
                  scrollMarginTop: "5rem",
                }}
              >
                {/* Priority header band: red = crucial, yellow = important,
                    blue = nice-to-have. The category is secondary context. */}
                <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ background: pri.wash, borderBottom: `1px solid ${pri.border}` }}>
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: pri.color }}>
                    {pri.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>{CATEGORY_META[def.category].label}</span>
                    {gap && <span className="text-[10px] font-medium" style={{ color: "var(--warning)" }}>● gap</span>}
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{def.title}</h3>
                    {def.wizardField && (
                      <span className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--surface-3)", color: "var(--ink-tertiary)" }}>
                        feeds launch form
                      </span>
                    )}
                  </div>
                  {!isEditingThis && (
                    <button
                      onClick={() => startEdit(def.key)}
                      aria-label={`Edit ${def.title}`}
                      className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors"
                      style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
                    >
                      {gap ? "Add" : "Edit"}
                    </button>
                  )}
                </div>

                {isEditingThis ? (
                  <div className="space-y-3">
                    {/* What good looks like — shown BEFORE they have to guess */}
                    <div className="rounded-[var(--radius-sm)] p-3" style={{ background: "var(--accent-wash)", border: "1px solid var(--accent-ring)" }}>
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--ink-primary)" }}>
                        <Icon name="compass" size="0.85rem" style={{ color: "var(--accent)" }} /> What a media buyer needs here:
                      </p>
                      <ul className="space-y-0.5">
                        {def.editGuidance.map((g, i) => (
                          <li key={i} className="text-[11px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>• {g}</li>
                        ))}
                      </ul>
                    </div>

                    <p className="text-[11px]" style={{ color: "var(--ink-tertiary)" }}>
                      Drag to reorder — <b>top items get the most weight</b> in daily ad decisions.
                    </p>

                    {/* Ordered line items: full content wraps and stays visible
                        (auto-growing textarea). Drag by the handle; reorder by
                        keys too. */}
                    <ul className="space-y-1.5">
                      {lines.map((line, i) => (
                        <li
                          key={i}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (dragIndex !== null && dragIndex !== i) moveLine(dragIndex, i); setDragIndex(null); }}
                          className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2 py-2"
                          style={{
                            background: "var(--surface-inset)",
                            border: `1px solid ${dragIndex === i ? "var(--accent-ring)" : "var(--line-subtle)"}`,
                          }}
                        >
                          <span
                            draggable
                            onDragStart={() => setDragIndex(i)}
                            onDragEnd={() => setDragIndex(null)}
                            className="mt-1 select-none text-sm"
                            style={{ color: "var(--ink-muted)", cursor: "grab" }}
                            aria-hidden
                            title="Drag to reorder"
                          >
                            ⠿
                          </span>
                          <span className="tabular-nums mt-1 w-4 shrink-0 text-center text-[11px] font-bold" style={{ color: i === 0 ? "var(--accent)" : "var(--ink-muted)" }}>{i + 1}</span>
                          <textarea
                            rows={1}
                            ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
                            className="w-full resize-none bg-transparent text-xs leading-relaxed outline-none"
                            style={{ color: "var(--ink-primary)" }}
                            value={line}
                            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }}
                            onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? e.target.value : l)))}
                            aria-label={`${def.title} item ${i + 1}`}
                          />
                          <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
                            <button onClick={() => moveLine(i, i - 1)} disabled={i === 0} aria-label="Move up" className="px-1 text-xs disabled:opacity-30" style={{ color: "var(--ink-tertiary)" }}>↑</button>
                            <button onClick={() => moveLine(i, i + 1)} disabled={i === lines.length - 1} aria-label="Move down" className="px-1 text-xs disabled:opacity-30" style={{ color: "var(--ink-tertiary)" }}>↓</button>
                            <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Delete item" className="px-1 text-xs" style={{ color: "var(--danger)" }}>×</button>
                          </div>
                        </li>
                      ))}
                      {lines.length === 0 && (
                        <li className="rounded-[var(--radius-sm)] px-3 py-2 text-[11px] italic" style={{ background: "var(--surface-inset)", color: "var(--ink-muted)" }}>
                          No items yet — add your first below.
                        </li>
                      )}
                    </ul>

                    <div className="flex gap-2">
                      <input
                        className={inputCls}
                        style={inputStyle}
                        value={newLine}
                        onChange={(e) => setNewLine(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNewLine(); } }}
                        placeholder="Add a line item and press Enter…"
                        aria-label={`Add item to ${def.title}`}
                      />
                      <button onClick={commitNewLine} className="shrink-0 rounded-[var(--radius-sm)] px-3 text-xs" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>Add</button>
                    </div>

                    {/* Check-my-work results: warnings only, nothing changed */}
                    {checkResult && (
                      <div
                        className="rounded-[var(--radius-sm)] p-3"
                        style={
                          checkResult.verdict === "solid"
                            ? { background: "var(--success-wash)", border: "1px solid rgba(74,222,128,0.3)" }
                            : { background: "var(--warning-wash)", border: "1px solid rgba(251,191,36,0.3)" }
                        }
                      >
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--ink-primary)" }}>
                          <Icon
                            name={checkResult.verdict === "solid" ? "check" : checkResult.verdict === "error" ? "alert" : "search"}
                            size="0.85rem"
                            strokeWidth={2.25}
                            style={{ color: checkResult.verdict === "solid" ? "var(--success)" : "var(--warning)" }}
                          />
                          {checkResult.summary}
                        </p>
                        {checkResult.warnings.map((w, i) => (
                          <div key={i} className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                            <b style={{ color: "var(--warning)" }}>Missing: {w.missing}</b>
                            <br />{w.why}
                            {w.example && (
                              <>
                                <br />
                                <span style={{ color: "var(--ink-tertiary)" }}>Try adding: “{w.example}”</span>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={saveSection}
                        disabled={savingSection}
                        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
                        style={{ background: "var(--accent)" }}
                      >
                        {savingSection ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={checkMyWork}
                        disabled={checking2}
                        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        style={{ background: "var(--human-wash)", border: "1px solid var(--human)", color: "var(--human)" }}
                      >
                        {checking2 ? "Checking with your co-pilot…" : "🔍 Check my work"}
                      </button>
                      <button onClick={() => setEditKey(null)} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>Cancel</button>
                    </div>
                  </div>
                ) : gap ? (
                  <p className="text-xs italic" style={{ color: "var(--ink-muted)" }}>{def.hint}</p>
                ) : (
                  <ol className="space-y-1">
                    {sectionToLines(content).map((line, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                        <span className="tabular-nums shrink-0 font-bold" style={{ color: i === 0 ? "var(--accent)" : "var(--ink-muted)" }}>{i + 1}</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {p.isAdmin && (
        <section className="rounded-[var(--radius-lg)] p-5" style={{ background: "var(--danger-wash)", border: "1px solid var(--danger)" }}>
          <h2 className="font-display text-base font-semibold" style={{ color: "var(--danger)" }}>Danger zone</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-secondary)" }}>
            Permanently delete this ad account and every campaign, alert, and profile under it. This cannot be undone.
          </p>
          <button
            onClick={deleteClient}
            disabled={deleting}
            className="mt-3 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--danger)" }}
          >
            {deleting ? "Deleting…" : "Delete ad account"}
          </button>
        </section>
      )}
    </div>
  );
}
