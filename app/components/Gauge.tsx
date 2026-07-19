// Signature element: campaign/budget health as a chunky rounded arc, not a
// flat progress bar. A 270° sweep so it reads like a dial you'd glance at on
// a dashboard, not a loading indicator.
const SWEEP_DEG = 270;
const START_DEG = 135; // rotate so the gap sits at the bottom

const TONE = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  accent: "var(--accent)",
  neutral: "var(--ink-muted)",
} as const;

export function Gauge({
  value, // 0-100
  label,
  displayValue,
  tone = "accent",
  size = 148,
}: {
  value: number;
  label: string;
  displayValue: string;
  tone?: keyof typeof TONE;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = size * 0.09;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arcLength = (SWEEP_DEG / 360) * circumference;
  const filled = (clamped / 100) * arcLength;

  return (
    <div className="flex flex-col items-center gap-2" role="img" aria-label={`${label}: ${displayValue}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-[135deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={TONE[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{ transition: "stroke-dasharray 400ms cubic-bezier(0.23,1,0.32,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display tabular-nums text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>
            {displayValue}
          </span>
        </div>
      </div>
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>
        {label}
      </div>
    </div>
  );
}
