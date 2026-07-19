"use client";

import { useRouter } from "next/navigation";
import { Icon, IconName } from "./Icon";

const META: Record<string, { label: string; icon: IconName }> = {
  BILLING_ERROR: { label: "Billing problem", icon: "alert" },
  ACCOUNT_RESTRICTED: { label: "Account restricted", icon: "shield" },
  TOKEN_INVALID: { label: "Token invalid", icon: "shield" },
  BUDGET_RECOMMENDATION: { label: "Budget recommendation (approval required)", icon: "chart" },
  RELAUNCH_RECOMMENDED: { label: "Campaign rebuild recommended", icon: "refresh" },
  INSIGHT_REQUEST: { label: "Your co-pilot needs your input", icon: "compass" },
  GENERAL: { label: "Alert", icon: "alert" },
};

export function AlertBanner({ id, type, message }: { id: string; type: string; message: string }) {
  const router = useRouter();
  const soft = type === "BUDGET_RECOMMENDATION" || type === "INSIGHT_REQUEST" || type === "RELAUNCH_RECOMMENDED";
  const m = META[type] ?? META.GENERAL;
  const tone = soft ? "var(--info)" : "var(--danger)";
  const wash = soft ? "var(--info-wash)" : "var(--danger-wash)";

  async function dismiss() {
    await fetch(`/api/alerts/${id}`, { method: "POST" });
    router.refresh();
  }

  return (
    <div
      className="pop-in flex items-start justify-between gap-4 rounded-xl border p-4 text-sm"
      style={{ borderColor: "var(--line-standard)", background: wash, color: tone }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: wash, color: tone }}>
          <Icon name={m.icon} size="1rem" />
        </span>
        <div style={{ color: "var(--ink-secondary)" }}>
          <span className="font-semibold" style={{ color: tone }}>{m.label}: </span>
          {message}
        </div>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 rounded-md px-2 py-1 text-xs opacity-70 transition-opacity hover:bg-[var(--surface-3)] hover:opacity-100"
        style={{ color: "var(--ink-tertiary)" }}
      >
        Dismiss
      </button>
    </div>
  );
}
