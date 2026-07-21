"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const taCls =
  "w-full rounded-lg border border-[var(--line-standard)] bg-[var(--surface-1)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

/**
 * Post-launch editor for the per-campaign directive + A/B notes. These steer
 * the daily optimizer; the copy makes the 9am-UTC check time explicit so the
 * owner knows their deadline to change course.
 */
export function DirectiveEditor({
  campaignId,
  initialDirective,
  initialAbNotes,
  abTest,
  directiveAt,
}: {
  campaignId: string;
  initialDirective: string;
  initialAbNotes: string;
  abTest: boolean;
  directiveAt: string | null;
}) {
  const router = useRouter();
  const [directive, setDirective] = useState(initialDirective);
  const [abNotes, setAbNotes] = useState(initialAbNotes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const localCheckTime = useMemo(() => {
    try {
      const d = new Date();
      d.setUTCHours(9, 0, 0, 0);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch {
      return "";
    }
  }, []);

  const dirty = directive !== initialDirective || abNotes !== initialAbNotes;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directive, ...(abTest ? { abNotes } : {}) }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(`⚠️ ${json.error ?? "Save failed."}`);
    setMsg("✅ Saved — steers the next daily check.");
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-5">
      <h2 className="mb-1 font-medium text-[var(--ink-primary)]">Campaign directive</h2>
      <p className="mb-3 text-xs text-[var(--ink-muted)]">
        Steer this campaign&rsquo;s daily optimization. The AI reviews daily at <b>9:00&nbsp;AM UTC</b>
        {localCheckTime ? ` (${localCheckTime} your time)` : ""} — update before then to change the next check.
        {directiveAt ? ` Last set ${new Date(directiveAt).toLocaleDateString()}.` : ""}
      </p>
      <textarea
        className={taCls}
        rows={3}
        value={directive}
        onChange={(e) => setDirective(e.target.value)}
        placeholder="e.g. Prioritise weekday corporate bookings; keep spend flat; favour the video creative."
      />
      {abTest && (
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-[var(--ink-secondary)]">
            A/B — what&rsquo;s different &amp; what to watch
          </label>
          <textarea className={taCls} rows={2} value={abNotes} onChange={(e) => setAbNotes(e.target.value)} />
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save directive"}
        </button>
        {msg && <span className="text-sm text-[var(--ink-secondary)]">{msg}</span>}
      </div>
    </section>
  );
}
