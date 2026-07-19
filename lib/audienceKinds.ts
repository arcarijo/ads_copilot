// Pure-data registry for the Audience Studio: each entry maps a piece of
// owner knowledge ("here are my past clients") onto a Meta audience endpoint,
// expressed as a form spec written in owner language. Client-safe — no
// server imports; the orchestration lives in lib/audiences.ts.

export interface AudienceKindSpec {
  kind: string;
  emoji: string;
  title: string; // owner language, not API language
  knowledgePrompt: string; // the question that extracts their knowledge
  coaching: string; // why this matters, promoter voice
  createsOnMeta: boolean;
  fields: {
    key: string;
    label: string;
    help: string;
    type: "text" | "textarea" | "number" | "select";
    options?: string[];
    required?: boolean;
  }[];
}

export const AUDIENCE_KINDS: AudienceKindSpec[] = [
  {
    kind: "CUSTOMER_LIST",
    emoji: "📇",
    title: "Your past clients",
    knowledgePrompt:
      "Who has already booked with you? Paste emails and/or phone numbers from your booking system, inquiry inbox, or guest lists.",
    coaching:
      "Your booking history is the strongest signal Meta can get — these are proven buyers. Everything is SHA-256 hashed on our server before it ever reaches Meta; raw contact info is never stored or sent.",
    createsOnMeta: true,
    fields: [
      { key: "name", label: "Audience name", help: 'e.g. "Past wedding clients 2024–2026"', type: "text", required: true },
      { key: "contacts", label: "Emails / phone numbers", help: "One per line, or comma-separated. Mixed emails and phones are fine — we sort them out.", type: "textarea", required: true },
    ],
  },
  {
    kind: "ENGAGEMENT",
    emoji: "❤️",
    title: "People who engage with your Page",
    knowledgePrompt: "Everyone who has interacted with your Facebook Page recently — they already know who you are.",
    coaching: "Warm audiences convert at a fraction of cold-traffic cost. This is the retargeting pool every working promoter builds first.",
    createsOnMeta: true,
    fields: [
      { key: "name", label: "Audience name", help: 'e.g. "Page engagers — last 180 days"', type: "text", required: true },
      { key: "retentionDays", label: "How far back?", help: "How many days of engagement to include (up to 365).", type: "select", options: ["30", "90", "180", "365"], required: true },
    ],
  },
  {
    kind: "LOOKALIKE",
    emoji: "👯",
    title: "More people like your best customers",
    knowledgePrompt: "Pick one of your existing audiences and Meta finds the people in your country who most resemble them.",
    coaching:
      "Lookalikes are how small budgets scale: 1% = closest match (best for tight budgets), 5–10% = broader reach. Build one from your past-clients list once it has 100+ people.",
    createsOnMeta: true,
    fields: [
      { key: "name", label: "Audience name", help: 'e.g. "Lookalike of past clients — 1%"', type: "text", required: true },
      { key: "originAudienceLocalId", label: "Source audience", help: "Which of your audiences should Meta learn from?", type: "select", options: [], required: true },
      { key: "country", label: "Country", help: "Two-letter code where Meta hunts for similar people.", type: "select", options: ["CA", "US"], required: true },
      { key: "ratio", label: "How similar?", help: "1 = closest 1% (recommended to start), up to 10.", type: "select", options: ["1", "2", "5", "10"], required: true },
    ],
  },
  {
    kind: "BLUEPRINT",
    emoji: "🧬",
    title: "Targeting blueprint from your strategy",
    knowledgePrompt:
      "One click: we translate your Marketing Strategy (audiences, geography, interests) into a reusable targeting spec the campaign Copilot applies automatically.",
    coaching:
      "This is your strategy knowledge base made executable — age ranges, radius, and interests validated against Meta's live catalog. Rebuild it whenever your strategy meaningfully changes; the Copilot always uses the newest one.",
    createsOnMeta: false,
    fields: [{ key: "name", label: "Blueprint name", help: 'e.g. "Core wedding-couples targeting"', type: "text", required: true }],
  },
];
