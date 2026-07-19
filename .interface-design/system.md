# Copilot — Design System

Managed by the `impeccable` skill from here forward. Canonical strategic
context lives in `PRODUCT.md` — this file stays the visual/token reference.
2026 pivots: (1) color strategy **Committed** (coral owns nav + hero; data
stays neutral); (2) theme is **DARK by default** (owners found light too
bright — flipped back 2026-07-18): warm charcoal-espresso surfaces
(#14110e canvas → #1b1713 cards → #221d18 → #2b241d), warm off-white ink
#f4ece0 (4 levels), borders+tonal-steps depth. Semantic colors are the
BRIGHT variants (success #4ade80, warning #fbbf24, danger #fb7185, info
#7dd3fc, creative #f472b6) — text-safe on dark. `--human` is #a78bfa
(text-safe on dark); solid human fills pair with DARK ink #160e28, never
white. Coral (#ff7a52) still pairs ONLY with dark ink #1a0f08, never white
text; `--hero-gradient` (deep stops, ≥5:1 under white) unchanged. The
cheery/playful personality survives the dark flip via coral energy, rounded
type, and coaching voice. All pages are fully token-bound — a theme flip is
one globals.css rewrite plus auditing hardcoded text pairings on --human
fills (the recurring gotcha when --human changes lightness).

## Direction & feel
A friendly AI co-pilot for small-business Meta ad spend — warm mission-control
at sunrise, not generic dark SaaS, not a Meta-blue clone. Bold, energetic,
confident — never toy-like: real money is on the line, so numbers stay
legible under any amount of visual energy, and the boldness is expressed as
decisive hierarchy and real color commitment, not decoration or theatrics.

**Domain:** liftoff/launch, budget fuel-gauge, targeting bullseye, daily
co-pilot briefing, traffic-light decisions (keep/pause/scale), A/B
fork-in-the-road, mission-control console, sunrise check-in ritual.

**Signature element:** the product is a human↔AI dialogue, made visible.
Two distinct voices:
- 🎯 **Manager Directive** (human) — plum/`--human`, used for the manager's
  own steering notes to the optimizer.
- 🧭 **Co-Pilot** (AI) — coral/`--accent`, used for AI-authored content
  (daily reports, optimizer actions, the nav mark).

Campaign/budget health renders as a chunky rounded **arc-gauge**
(`app/components/Gauge.tsx`, 270° sweep) instead of a flat progress bar.

## Typography
- Display/headings/numbers: **Sora** (`--font-display`, `.font-display`) —
  rounded, geometric, confident. Used for h1–h4 and any hero number.
- Body/UI: **Plus Jakarta Sans** (`--font-sans`) — warm, rounded, highly
  legible. Default body font.
- Both loaded via `next/font/google` in `app/layout.tsx`, self-hosted at
  build time (no runtime network call).
- Tabular numbers (`.tabular-nums` / `[data-tabular]`) on every dynamic
  metric to prevent layout shift.

## Color tokens (`app/globals.css`)
Warm ink base, never blue-black. One real accent (coral) does all primary-
action work; every other hue is purely semantic.

| Token | Use |
|---|---|
| `--surface-0/1/2/3` | page canvas → card → popover → hover, warm charcoal, each a few % lighter |
| `--surface-inset` | inputs — darker than surroundings (inset, not raised) |
| `--ink-primary/secondary/tertiary/muted` | 4-level text hierarchy, warm off-white |
| `--line-subtle/standard/strong` | borders, low-opacity warm white, near-invisible until needed |
| `--accent` / `--accent-strong` / `--accent-deep` / `--accent-wash` | coral/tangerine — primary actions, AI/Co-Pilot voice, brand mark. `-deep` is the gradient-safe anchor (≥5:1 vs white; `--accent`/`--accent-strong` are NOT safe under white text — dark `#1a0f08` ink only) |
| `--human` / `--human-deep` / `--human-wash` | plum/violet — the manager's own voice (Directive) only |
| `--hero-gradient` | coral-deep → plum-deep, the two voices meeting. The ONE full-bleed color moment per screen — never tiled, never behind dense data. Built entirely from `-deep` stops so every point along it holds ≥5:1 contrast with white text (verified by computed relative luminance, not eyeballed) |
| `--success` `--warning` `--danger` `--info` `--creative` (+ `-wash`) | semantic meaning only — status, category tags. Never decorative. |

**Contrast rule, non-negotiable:** `--accent` and `--accent-strong` (the light/mid coral) read ~2.6:1 against white — fails AA. Always pair them with dark `#1a0f08` ink text, exactly like the button pattern. Only the `-deep` tokens and `--hero-gradient` are safe under white/light text.

## Depth strategy
**Surface-color shifts, not shadows.** Dark mode: borders + tonal elevation
steps do the work (shadows barely read on dark). Card = `surface-1` on
`surface-0` canvas with a `1px solid var(--line-subtle)` border. Nested
surface (e.g. strategy card inside its section) steps up to `surface-2`.

## Radius scale (concentric)
- `--radius-sm` (8px): inputs, buttons, small pills
- `--radius-md` (14px): cards, list rows
- `--radius-lg` (20px): section containers, modals, hero panels

## Spacing
4px base unit, Tailwind defaults (which are already 4px multiples) used
throughout — no arbitrary pixel values outside the token set above.

## Key component patterns
- **Button (primary)** — `var(--accent)` bg, `#1a0f08` text (dark warm
  brown, not pure black, for warmth), `rounded-[var(--radius-sm)]`,
  `active:scale-[0.97]` press feedback.
- **Button (secondary/outline)** — transparent bg, `1px solid
  var(--line-standard)`, `var(--ink-secondary)` text.
- **Status pill** — small dot (`--success`/`--warning`/`--danger`/`--info`)
  + label, `-wash` background, rounded-full.
- **Nav** — solid `var(--accent)` bar (Committed moment #1), dark
  `#1a0f08` ink text throughout, not a wash. `app/layout.tsx`.
- **Dashboard hero** — solid `var(--hero-gradient)` full-bleed panel
  (Committed moment #2), one `.text-hero` white numeral (`clamp(3.5rem,
  9vw, 6rem)`, weight 700, tracking -0.035em) as the single focal point,
  secondary metrics demoted to translucent-white (`rgba(255,255,255,.65-.8)`)
  small text. `app/page.tsx`.
- **Gauge** — `app/components/Gauge.tsx`. 270° arc, `--surface-3` track,
  semantic tone fill, center label in `.font-display tabular-nums`.
  Currently unused (dashboard moved to the hero-numeral pattern above) —
  reserved for a future campaign-detail-page hero.
- **Strategy card** — `surface-2` body, full-width **header band** in
  category `-wash` color with bold uppercase category label + priority
  badge (`CATEGORY_COLOR` in ClientManager.tsx), neutral body below.
  **Never a side-stripe/left-border accent — that's an Impeccable absolute
  ban** (thin colored `border-left`/`border-right` on cards). Use a full
  header band, a solid border, or a background tint instead, always.
- **Manager Directive / Co-Pilot voice blocks** — full-bleed wash
  background (`--human-wash` / `--accent-wash`) with a matching-hue soft
  border, distinct from the neutral `surface-1` used everywhere else —
  these are the only two "colored surface" blocks in the product, by design.

## Pages retokenized so far
`app/layout.tsx` (nav + fonts, Committed coral bar), `app/globals.css`
(tokens, hero gradient, `.text-hero`), `app/page.tsx` (dashboard, Committed
hero gradient panel), `app/clients/[id]/ClientManager.tsx` (strategy
profile + directive, header-band cards), `app/clients/page.tsx` (client
list), `app/login/page.tsx`.

**Not yet retokenized** (still on the old gray/emerald Tailwind palette, or
retokenized-but-Restrained rather than Committed — revisit when next
touched): `app/new/page.tsx` (campaign wizard), `app/campaigns/[id]/*`
(campaign detail — a strong candidate for a second `.text-hero` moment plus
the 🧭 Co-Pilot voice on the daily AI report), `app/clients/new`.

## Consistency rule
Always bind to the tokens above, never hardcode a Tailwind color utility
(`bg-emerald-500`, `text-white/70`, etc.) or a raw hex. If a new semantic
need arises, add a token here first, then use it. Before shipping any new
saturated-background + light-text combination, verify contrast against the
`-deep` rule above — don't eyeball it against `--accent`/`--accent-strong`.
