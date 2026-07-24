"use client";

import { useState } from "react";
import { Icon } from "../../components/Icon";

interface RemoteCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  updated_time?: string;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "var(--success)",
  PAUSED: "var(--warning)",
  ARCHIVED: "var(--ink-muted)",
  DELETED: "var(--ink-muted)",
};

/** Live view of what campaigns actually exist on Meta — includes ones made outside this app. */
export function MetaCampaignsPanel({ clientId }: { clientId: string }) {
  const [remote, setRemote] = useState<RemoteCampaign[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadRemote() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/clients/${clientId}/campaigns/remote`);
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setRemote([]);
      setMsg(`Couldn't read your Meta account: ${json.error ?? "unknown error"}`);
      return;
    }
    setRemote(json.remote ?? []);
    setMsg((json.remote ?? []).length === 0 ? "Your Meta ad account has no campaigns yet." : null);
  }

  return (
    <div className="rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>
            <Icon name="broadcast" size="1rem" style={{ color: "var(--accent)" }} /> What&apos;s live on Meta right now
          </h3>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Straight from Meta — includes campaigns launched outside this app.
          </p>
        </div>
        <button
          onClick={loadRemote}
          disabled={busy}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
        >
          {busy ? "Checking Meta…" : remote === null ? "Check what's there" : "Refresh"}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs" style={{ color: "var(--ink-secondary)" }}>{msg}</p>}
      {remote !== null && remote.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {remote.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs" style={{ background: "var(--surface-inset)" }}>
              <span className="font-semibold" style={{ color: "var(--ink-primary)" }}>{c.name}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--surface-3)", color: STATUS_COLOR[c.status] ?? "var(--ink-tertiary)" }}>
                {c.status.toLowerCase()}
              </span>
              {c.objective && (
                <span style={{ color: "var(--ink-muted)" }}>{c.objective.replace(/^OUTCOME_/, "").toLowerCase()}</span>
              )}
              {c.updated_time && (
                <span style={{ color: "var(--ink-muted)" }}>updated {c.updated_time.slice(0, 10)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
