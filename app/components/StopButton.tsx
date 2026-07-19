"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

/** EMERGENCY STOP — instantly pauses the campaign on Meta. */
export function StopButton({ campaignId, large }: { campaignId: string; large?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function stop() {
    if (!confirm("Emergency stop: pause this campaign on Meta immediately?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/stop`, { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setError(json.error ?? "Stop failed");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={stop}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 ${
          large ? "px-6 py-3 text-base" : "px-3 py-1.5 text-xs"
        }`}
        style={{ background: "var(--danger)" }}
      >
        {busy ? (
          <>
            <Icon name="refresh" size="0.9em" className="spin" /> Stopping…
          </>
        ) : (
          <>
            <Icon name="x" size="0.9em" strokeWidth={2.5} /> Cancel Campaign
          </>
        )}
      </button>
      {error && (
        <span className="flex items-center gap-1 text-xs" style={{ color: "var(--danger)" }}>
          <Icon name="alert" size="0.85em" /> {error}
        </span>
      )}
    </span>
  );
}
