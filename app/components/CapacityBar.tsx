import type { CapacityMetric } from "@/lib/capacity";

const TONE_COLOR: Record<CapacityMetric["tone"], string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

// Secondary/tertiary visual weight, deliberately distinct from the hero
// Gauge — this is a monitoring trip-wire, not the screen's focal point.
export function CapacityBar({ metric }: { metric: CapacityMetric }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--ink-secondary)" }}>{metric.label}</span>
        <span className="tabular-nums text-xs" style={{ color: TONE_COLOR[metric.tone] }}>
          {metric.used}/{metric.cap}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(3, metric.pct)}%`, background: TONE_COLOR[metric.tone], transitionDuration: "400ms" }}
        />
      </div>
      <p className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>{metric.detail}</p>
    </div>
  );
}
