"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

/** Permanently deletes a campaign that hasn't launched yet. */
export function DeleteCampaignButton({ campaignId, large }: { campaignId: string; large?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function del() {
    if (!confirm("Delete this campaign permanently? This can't be undone.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setBusy(false);
      setError(json.error ?? "Delete failed");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={del}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 ${
          large ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"
        }`}
        style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}
      >
        <Icon name="x" size="0.9em" strokeWidth={2.5} /> {busy ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <span className="flex items-center gap-1 text-xs" style={{ color: "var(--danger)" }}>
          <Icon name="alert" size="0.85em" /> {error}
        </span>
      )}
    </span>
  );
}
