/**
 * Input validation/sanitization for client-onboarding fields. This is the
 * server-side security boundary: every value that reaches the DB from the
 * onboarding form (create) or the client editor (update) passes through here.
 *
 * Goals: reject injection payloads and malicious URLs, keep Meta IDs strictly
 * numeric, and constrain free-text length. React escapes on render, so the main
 * risks we defend against are stored malicious URLs (javascript:/data: schemes),
 * off-platform social links, and oversized/control-character junk.
 */

import { CampaignIntent, toCampaignIntent } from "./campaignIntent";

/** Social links must point at one of these known platforms (host or subdomain). */
export const SOCIAL_HOSTS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
];

/** Google Business links resolve to one of these hosts. */
const GOOGLE_HOSTS = ["google.com", "goo.gl", "business.google.com"];

// C0 control chars (0x00-0x1F) plus DEL (0x7F). Built via RegExp to keep
// literal control bytes out of source.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/** Strip control chars, trim, and cap length. */
export function cleanText(v: unknown, maxLen: number): string {
  return String(v ?? "")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, maxLen);
}

export function isEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Meta IDs are numeric strings; tolerate a leading `act_` on ad accounts. */
export function numericId(v: unknown): string | null {
  const s = String(v ?? "")
    .trim()
    .replace(/^act_/i, "");
  return /^\d{1,25}$/.test(s) ? s : null;
}

/**
 * Returns a normalized https URL, or null if invalid. Rejects any non-https
 * scheme (blocks javascript:/data:/file:). When `allowedHosts` is given, the
 * URL's host must match one of them (exact or subdomain).
 */
export function safeUrl(v: unknown, allowedHosts?: string[]): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (allowedHosts && !allowedHosts.some((h) => host === h || host.endsWith("." + h))) {
    return null;
  }
  return u.toString();
}

/** Opaque credential: bounded length, no whitespace/control chars, safe charset. */
export function safeToken(v: unknown, maxLen = 1024): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > maxLen) return null;
  return /^[A-Za-z0-9._\-|~]+$/.test(s) ? s : null;
}

// ---------------- Campaign input sanitization ----------------
// The New Campaign form collects a lot of free text + URLs. This is the
// server-side trust boundary for that surface: every value is length-bounded,
// control-char stripped, URL-scheme checked (https only), and enum-guarded
// before it is stored or handed to the AI / Meta. Mirrors validateClientFields.

// Budget floor/ceiling in cents — kept local to avoid importing guardrail logic.
const CAMPAIGN_MIN_BUDGET_CENTS = 10_000; // $100
const CAMPAIGN_MAX_BUDGET_CENTS = 300_000; // $3,000 (global lifetime cap)

export interface CleanCreative {
  kind: "IMAGE" | "CAROUSEL" | "VIDEO";
  label: string;
  filePaths: string[];
  primaryText: string;
  headline: string;
  linkUrl: string;
}

export interface CampaignInputValues {
  campaignName: string;
  goal: string;
  landingPageUrl: string;
  targetAudience: string;
  budgetCents: number;
  budgetType: "DAILY" | "LIFETIME";
  durationDays: number;
  creatives: CleanCreative[];
  abTest: boolean;
  abVariable?: "CREATIVE" | "AUDIENCE";
  abNotes: string;
  campaignDirective: string;
  campaignIntent?: CampaignIntent;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validate + sanitize the New Campaign questionnaire. Returns `{ error }` on a
 * hard failure (missing name, bad URL) or `{ values }` with cleaned fields.
 * Media file paths are length-bounded here; their URL/Drive validity is
 * enforced again at launch (normalizeMediaUrl). linkUrl must be https.
 */
export function sanitizeCampaignInput(b: Record<string, unknown>): { error: string } | { values: CampaignInputValues } {
  const campaignName = cleanText(b.campaignName, 120);
  if (!campaignName) return { error: "Campaign name is required." };

  const goal = cleanText(b.goal, 60) || "Booking inquiries";

  let landingPageUrl = "";
  const rawLanding = String(b.landingPageUrl ?? "").trim();
  if (rawLanding) {
    const u = safeUrl(rawLanding);
    if (!u) return { error: "Landing page must be a valid https:// URL." };
    landingPageUrl = u;
  }

  const targetAudience = cleanText(b.targetAudience, 4000);

  const budgetCents = clampInt(Number(b.budgetDollars) * 100, CAMPAIGN_MIN_BUDGET_CENTS, CAMPAIGN_MAX_BUDGET_CENTS, CAMPAIGN_MIN_BUDGET_CENTS);
  const budgetType: "DAILY" | "LIFETIME" = b.budgetType === "DAILY" ? "DAILY" : "LIFETIME";
  const durationDays = clampInt(b.durationDays, 1, 90, 14);

  const rawCreatives = Array.isArray(b.creatives) ? b.creatives : [];
  const creatives: CleanCreative[] = rawCreatives.slice(0, 10).map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const kind: CleanCreative["kind"] = c.kind === "CAROUSEL" || c.kind === "VIDEO" ? c.kind : "IMAGE";
    const filePaths = (Array.isArray(c.filePaths) ? c.filePaths : [])
      .map((p) => cleanText(p, 600))
      .filter(Boolean)
      .slice(0, 10);
    const linkRaw = String(c.linkUrl ?? "").trim();
    const linkUrl = linkRaw ? safeUrl(linkRaw) ?? "" : "";
    return {
      kind,
      label: cleanText(c.label, 60) || `Creative ${String.fromCharCode(65 + i)}`,
      filePaths,
      primaryText: cleanText(c.primaryText, 2000),
      headline: cleanText(c.headline, 255),
      linkUrl,
    };
  });

  const abTest = Boolean(b.abTest);
  const abVariable = b.abVariable === "AUDIENCE" ? "AUDIENCE" : b.abVariable === "CREATIVE" ? "CREATIVE" : undefined;
  const abNotes = abTest ? cleanText(b.abNotes, 2000) : "";
  const campaignDirective = cleanText(b.campaignDirective, 2000);
  // Intent is an enum-guarded strategic frame (may be absent on legacy drafts).
  const campaignIntent = toCampaignIntent(b.campaignIntent) ?? undefined;

  return {
    values: { campaignName, goal, landingPageUrl, targetAudience, budgetCents, budgetType, durationDays, creatives, abTest, abVariable, abNotes, campaignDirective, campaignIntent },
  };
}

export interface ClientFieldValues {
  name?: string;
  contactEmail?: string | null;
  website?: string | null;
  gmbUrl?: string | null;
  socialLinks?: string[];
  metaAdAccountId?: string;
  metaPageId?: string;
  metaSystemUserName?: string | null;
  metaSystemUserId?: string | null;
  metaAppId?: string | null;
  metaAccessToken?: string;
  metaAppToken?: string | null;
}

type ValidationResult = { error: string } | { values: ClientFieldValues };

/**
 * Validate + sanitize onboarding/edit fields. `mode: "create"` enforces the
 * required fields; `mode: "update"` validates only the fields present in `b`.
 * Returns `{ error }` on the first failure, or `{ values }` with cleaned data.
 */
export function validateClientFields(b: Record<string, unknown>, mode: "create" | "update"): ValidationResult {
  const isCreate = mode === "create";
  const v: ClientFieldValues = {};
  const present = (k: string) => b[k] !== undefined;

  if (isCreate || present("name")) {
    const name = cleanText(b.name, 120);
    if (!name) return { error: "Business name is required." };
    v.name = name;
  }

  if (present("contactEmail")) {
    const raw = cleanText(b.contactEmail, 254);
    if (raw && !isEmail(raw)) return { error: "Contact email is not a valid email address." };
    v.contactEmail = raw || null;
  }

  if (present("website")) {
    const raw = String(b.website ?? "").trim();
    if (raw) {
      const u = safeUrl(raw);
      if (!u) return { error: "Website must be a valid https:// URL." };
      v.website = u;
    } else v.website = null;
  }

  if (present("gmbUrl")) {
    const raw = String(b.gmbUrl ?? "").trim();
    if (raw) {
      const u = safeUrl(raw, GOOGLE_HOSTS);
      if (!u) return { error: "Google Business link must be a valid Google https URL." };
      v.gmbUrl = u;
    } else v.gmbUrl = null;
  }

  if (present("socialLinks")) {
    const arr = Array.isArray(b.socialLinks) ? b.socialLinks : String(b.socialLinks ?? "").split("\n");
    const out: string[] = [];
    for (const s of arr) {
      const raw = String(s ?? "").trim();
      if (!raw) continue;
      const u = safeUrl(raw, SOCIAL_HOSTS);
      if (!u) {
        return {
          error: `"${raw.slice(0, 60)}" is not allowed — social links must be https and on a supported platform (Instagram, Facebook, TikTok, X, LinkedIn, YouTube).`,
        };
      }
      out.push(u);
    }
    v.socialLinks = out;
  }

  if (isCreate || present("metaAdAccountId")) {
    const id = numericId(b.metaAdAccountId);
    if (!id) return { error: 'Ad Account ID must be numeric (digits only, without "act_").' };
    v.metaAdAccountId = id;
  }

  if (isCreate || present("metaPageId")) {
    const id = numericId(b.metaPageId);
    if (!id) return { error: "Page ID must be numeric." };
    v.metaPageId = id;
  }

  if (present("metaSystemUserName")) {
    v.metaSystemUserName = cleanText(b.metaSystemUserName, 80) || null;
  }

  if (present("metaSystemUserId")) {
    const raw = String(b.metaSystemUserId ?? "").trim();
    if (raw) {
      const id = numericId(raw);
      if (!id) return { error: "System User ID must be numeric." };
      v.metaSystemUserId = id;
    } else v.metaSystemUserId = null;
  }

  if (present("metaAppId")) {
    const raw = String(b.metaAppId ?? "").trim();
    if (raw) {
      const id = numericId(raw);
      if (!id) return { error: "App ID must be numeric." };
      v.metaAppId = id;
    } else v.metaAppId = null;
  }

  if (isCreate || (present("metaAccessToken") && String(b.metaAccessToken ?? "").trim())) {
    const t = safeToken(b.metaAccessToken);
    if (!t) return { error: "Access token is missing or contains invalid characters." };
    v.metaAccessToken = t;
  }

  if (present("metaAppToken")) {
    const raw = String(b.metaAppToken ?? "").trim();
    if (raw) {
      const t = safeToken(raw);
      if (!t) return { error: "App token contains invalid characters." };
      v.metaAppToken = t;
    } else v.metaAppToken = null;
  }

  return { values: v };
}
