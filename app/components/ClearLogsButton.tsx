"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

/** Admin-only: permanently clears diagnostics log entries, optionally scoped to the active level filter. */
export function ClearLogsButton({ level }: { level?: string | null }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function clear() {
    const scope = level ? `all ${level} entries` : "the entire diagnostics log";
    if (!confirm(`Clear ${scope}? This can't be undone.`)) return;
    setBusy(true);
    const qs = level ? `?level=${encodeURIComponent(level)}` : "";
    await fetch(`/api/logs${qs}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={clear}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}
    >
      <Icon name="x" size="0.85em" strokeWidth={2.5} /> {busy ? "Clearing…" : level ? `Clear ${level}` : "Clear all"}
    </button>
  );
}
