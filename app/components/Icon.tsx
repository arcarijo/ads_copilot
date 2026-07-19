import type { CSSProperties } from "react";

// Branded icon set — one consistent stroke language (1.75px, round caps/joins,
// currentColor) replacing emojis across the product. Sized in `em` so icons
// scale with their surrounding text by default. Add `className="icon-nudge"`
// or `"icon-spin-hover"` on an icon inside a button for hover motion.

export type IconName =
  | "compass" | "target" | "sparkle" | "bolt" | "check" | "x" | "alert"
  | "arrow-right" | "arrow-up" | "arrow-down" | "plus" | "search" | "upload"
  | "file" | "broadcast" | "chart" | "grip" | "gauge" | "users" | "user"
  | "heart" | "contacts" | "dna" | "megaphone" | "pin" | "music" | "briefcase"
  | "refresh" | "pencil" | "trash" | "clock" | "mail" | "globe" | "shield";

const PATHS: Record<IconName, React.ReactNode> = {
  compass: (<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.1 5-5 2.1 2.1-5z" /></>),
  target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>),
  sparkle: (<path d="M12 3v4M12 17v4M5 12H3m18 0h-2M6.3 6.3 5 5m14 14-1.3-1.3M17.7 6.3 19 5M5 19l1.3-1.3M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2z" />),
  bolt: (<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />),
  check: (<path d="m4 12 5 5L20 6" />),
  x: (<path d="M6 6l12 12M18 6 6 18" />),
  alert: (<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>),
  "arrow-right": (<path d="M5 12h14M13 6l6 6-6 6" />),
  "arrow-up": (<path d="M12 19V5M6 11l6-6 6 6" />),
  "arrow-down": (<path d="M12 5v14M6 13l6 6 6-6" />),
  plus: (<path d="M12 5v14M5 12h14" />),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  upload: (<><path d="M12 15V3M8 7l4-4 4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>),
  file: (<><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M18 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l5 5v11a1 1 0 0 1-1 1Z" /></>),
  broadcast: (<><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" /></>),
  chart: (<><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>),
  grip: (<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="2.5" />),
  gauge: (<><path d="M12 14a2 2 0 1 0 2-2" /><path d="M3.5 18a10 10 0 1 1 17 0" /><path d="m14 12 3-3" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3.5 3.5 0 0 1 0 6.5M18 20a6 6 0 0 0-3-5.2" /></>),
  user: (<><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>),
  heart: (<path d="M12 20s-7-4.4-9.2-8.4A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5.6C19 15.6 12 20 12 20Z" />),
  contacts: (<><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="12" cy="10" r="2.2" /><path d="M8.5 16a3.5 3.5 0 0 1 7 0" /></>),
  dna: (<path d="M7 3c0 5 10 6 10 11M17 3c0 5-10 6-10 11M7 21c0-1 10-2 10-7M17 21c0-1-10-2-10-7M8 6h8M8.5 9h7M8.5 15h7M8 18h8" />),
  megaphone: (<><path d="M3 11v2a1 1 0 0 0 1 1h2l7 4V6l-7 4H4a1 1 0 0 0-1 1Z" /><path d="M17 8a5 5 0 0 1 0 8" /></>),
  pin: (<><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z" /><circle cx="12" cy="11" r="2.5" /></>),
  music: (<><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>),
  briefcase: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></>),
  refresh: (<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />),
  pencil: (<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3ZM14 6l3 3" />),
  trash: (<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></>),
  shield: (<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3ZM9.5 12l1.8 1.8L15 10" />),
};

export function Icon({
  name,
  size = "1.15em",
  className,
  style,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
