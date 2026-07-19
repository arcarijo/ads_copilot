// Canonical strategy-profile schema. Pure data (no server deps) so both the
// server (research/ground-truth) and client components (UI) can import it.
//
// Each section is a category of marketing strategic intelligence the Meta Ads
// manager uses to tweak settings. Priorities and wizard mappings come from the
// project's 2026 Meta Ads research: audience, geography (Advantage+ on/off),
// and economics (target CPA + objective) are the critical launch levers.

export type SectionCategory = "IDENTITY" | "AUDIENCE" | "TARGETING" | "ECONOMICS" | "CREATIVE" | "GUARDRAIL";

export interface ProfileSectionDef {
  key: string;
  title: string;
  category: SectionCategory;
  priority: "critical" | "important" | "nice";
  // Which campaign-wizard field this section can pre-fill (ongoing ground truth).
  wizardField?: "targetAudience" | "geography" | "goal" | "landingPageUrl";
  hint: string; // shown in the gap-fill form
  // What a senior media buyer would want in this section, written for owners
  // who don't know marketing. Shown while editing, so they know what "good"
  // looks like before the AI has to flag the gap.
  editGuidance: string[];
}

export const PROFILE_SECTIONS: ProfileSectionDef[] = [
  {
    key: "overview", title: "Business Overview", category: "IDENTITY", priority: "important",
    hint: "What the business is and how it positions itself.",
    editGuidance: [
      "One line on what makes people pick you over the venue down the street",
      "The vibe of the space in plain words (industrial-chic loft? cozy garden room?)",
      "How long you've been operating and roughly how many events you host a year",
    ],
  },
  {
    key: "products", title: "Products & Services", category: "IDENTITY", priority: "important",
    hint: "Core offerings and prices.",
    editGuidance: [
      "Each package or rental option with its real price or price range",
      "What's included vs. add-ons (catering, AV, staffing, bar)",
      "Your most profitable offering — the one ads should push hardest",
    ],
  },
  {
    key: "audiences", title: "Target Audiences", category: "AUDIENCE", priority: "critical",
    hint: "Who to target: segments, age ranges, motivations.",
    editGuidance: [
      "Each customer type on its own line, WITH an age range (e.g. \"Engaged couples 26–38\") — Meta delivery needs the numbers",
      "What each group actually cares about when choosing you (price? photos? date flexibility?)",
      "Who books vs. who pays, if different (e.g. office managers book, companies pay)",
      "Put your most valuable group first — top lines get the most weight in daily ad decisions",
    ],
  },
  {
    key: "geography", title: "Geography & Radius", category: "TARGETING", priority: "critical",
    hint: "Cities served and radius. Note if targeting must stay tight (turns Advantage+ Audience OFF).",
    editGuidance: [
      "How far people realistically travel to you, as a number (\"15km around the venue\")",
      "Neighbourhoods or suburbs your best customers actually come from",
      "Whether to stay strictly local or allow Meta to expand — say \"stay tight\" to lock expansion off",
    ],
  },
  {
    key: "economics", title: "Conversion Goals & Economics", category: "ECONOMICS", priority: "critical",
    hint: "Primary conversion action (e.g. booking inquiry) and target cost per result (CPA).",
    editGuidance: [
      "What a lead is worth: average booking value in dollars",
      "The most you'd happily pay for one qualified inquiry (your target cost per lead)",
      "How many inquiries typically become bookings (even a rough guess helps)",
      "How fast someone responds to new inquiries, and who owns that job — under 30 minutes is the industry standard",
    ],
  },
  {
    key: "brand", title: "Brand Voice & Creative Direction", category: "CREATIVE", priority: "important",
    hint: "Tone, and creative angles/formats that resonate. Creative is the #1 performance lever.",
    editGuidance: [
      "Three words for how your ads should sound (warm? bold? elegant?)",
      "Which real photos/videos of your space perform best — creative drives 50–70% of results",
      "Phrases from your best reviews worth echoing in ad copy",
    ],
  },
  {
    key: "constraints", title: "Constraints & Exclusions", category: "GUARDRAIL", priority: "nice",
    hint: "Geo limits, audiences to avoid, tone no-gos, seasonality.",
    editGuidance: [
      "Your busy and dead months — weddings peak Jan–Feb inquiries, corporate Sep–Oct",
      "Event types or audiences you do NOT want (be blunt — it saves budget)",
      "Dates already fully booked, so ads don't sell what you can't deliver",
    ],
  },
  {
    key: "direction", title: "Expert Marketing Direction", category: "TARGETING", priority: "important",
    hint: "Recommended objective, Advantage+ Audience ON/OFF, top 3 angles, biggest lever.",
    editGuidance: [
      "Usually AI-written from research — edit it if it misses how your business really works",
      "The single biggest thing ads should accomplish this quarter",
    ],
  },
];

export const CATEGORY_META: Record<SectionCategory, { label: string; blurb: string }> = {
  IDENTITY: { label: "Identity", blurb: "Who they are and what they sell" },
  AUDIENCE: { label: "Audience", blurb: "Who the ads should reach" },
  TARGETING: { label: "Targeting & Direction", blurb: "How Meta delivery is configured" },
  ECONOMICS: { label: "Goals & Economics", blurb: "What a result is worth" },
  CREATIVE: { label: "Creative", blurb: "Voice and angles that convert" },
  GUARDRAIL: { label: "Guardrails", blurb: "Hard limits and exclusions" },
};

export type Sections = Record<string, string>;

export function sectionDef(key: string): ProfileSectionDef | undefined {
  return PROFILE_SECTIONS.find((s) => s.key === key);
}

/**
 * Sections are stored as newline lists ("- item" per line) and edited as
 * ordered line items — order encodes the owner's priority, which the daily
 * optimizer weighs top-first. These helpers convert both directions and
 * tolerate legacy freeform prose (each sentence-ish line becomes an item).
 */
export function sectionToLines(content: string | undefined): string[] {
  if (!content?.trim()) return [];
  return content
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

export function linesToSection(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `- ${l}`)
    .join("\n");
}

/** A section counts as a gap when it is empty or too thin to be useful. */
export function isGap(content: string | undefined): boolean {
  return !content || content.trim().length < 20;
}

export interface Gap {
  key: string;
  title: string;
  priority: ProfileSectionDef["priority"];
  hint: string;
}

export function computeGaps(sections: Sections): Gap[] {
  return PROFILE_SECTIONS.filter((s) => isGap(sections[s.key])).map((s) => ({
    key: s.key,
    title: s.title,
    priority: s.priority,
    hint: s.hint,
  }));
}

/**
 * Merge freshly-researched sections onto existing ones WITHOUT erasing prior
 * strategy. A new section replaces the old only when it has real content;
 * otherwise the existing content is preserved. This makes "rebuild from web"
 * additive/enriching rather than destructive.
 */
export function mergeSections(existing: Sections, incoming: Sections): Sections {
  const out: Sections = { ...existing };
  for (const def of PROFILE_SECTIONS) {
    const next = (incoming[def.key] ?? "").trim();
    if (next.length >= 20) out[def.key] = next;
  }
  return out;
}

/** Render the structured sections into the markdown ground-truth text. */
export function buildProfileMd(sections: Sections): string {
  return PROFILE_SECTIONS.filter((s) => !isGap(sections[s.key]))
    .map((s) => `# ${s.title}\n${sections[s.key].trim()}`)
    .join("\n\n");
}

/** Best-effort back-compat: turn a legacy freeform profileMd into sections. */
export function sectionsFromLegacyMd(md: string): Sections {
  if (!md?.trim()) return {};
  const out: Sections = {};
  // Split on markdown H1 headers and match to canonical titles fuzzily.
  const parts = md.split(/\n(?=#\s)/);
  for (const part of parts) {
    const m = part.match(/^#\s*(.+)/);
    if (!m) continue;
    const heading = m[1].toLowerCase();
    const body = part.replace(/^#.*\n?/, "").trim();
    const def = PROFILE_SECTIONS.find((s) => heading.includes(s.title.toLowerCase().split(" ")[0]));
    if (def && body) out[def.key] = body;
  }
  // If nothing matched, stash the whole thing under overview.
  if (Object.keys(out).length === 0) out.overview = md.trim().slice(0, 1200);
  return out;
}
