// Ad-platform registry: one place that knows every platform we can connect,
// what credentials each needs (per-client, admin-entered), which app-level
// env keys the operator must provision, the OAuth scopes to request when a
// real sign-in flow ships, and the promoter-facing coaching knowledge for the
// vertical each platform serves. Pure data — safe to import from client
// components; secrets never live here.

export type PlatformKey = "META" | "GOOGLE" | "TIKTOK" | "PINTEREST" | "LINKEDIN";

export interface CredFieldSpec {
  key: string; // property inside PlatformConnection.credsJson
  label: string;
  help: string;
  secret?: boolean; // mask after save
  required?: boolean;
}

export interface PlatformSpec {
  key: PlatformKey;
  label: string;
  emoji: string;
  tagline: string; // when/why a venue uses this platform (coaching voice)
  vertical: string[]; // profile keywords that make the coach suggest it
  executes: boolean; // can our backend actually run ads on it today?
  envKeys: { key: string; label: string }[]; // app-level, .env — admin infra
  fields: CredFieldSpec[]; // per-client, stored in credsJson
  scopes: { scope: string; why: string }[];
  gotcha?: string; // the thing that bites you during onboarding
  signIn: { possible: boolean; note: string };
  coaching: string[]; // playbook bullets shown to the non-expert owner
}

export const PLATFORMS: PlatformSpec[] = [
  {
    key: "META",
    label: "Meta (Facebook & Instagram)",
    emoji: "📣",
    tagline: "Your always-on lead engine — local reach for every event type.",
    vertical: ["wedding", "party", "corporate", "concert", "event", "venue"],
    executes: true,
    envKeys: [],
    fields: [], // Meta credentials live on the client record (legacy columns)
    scopes: [
      { scope: "ads_management", why: "Create campaigns, pause ads, adjust targeting daily." },
      { scope: "ads_read", why: "Nightly analytics pull for the optimizer and your reports." },
      { scope: "pages_read_engagement", why: "Run ads from your business Page identity." },
    ],
    signIn: { possible: true, note: "Connected during onboarding via your system-user token — already live." },
    coaching: [
      "Meta is the workhorse: broadest local reach and the strongest lead-form tooling for venue inquiries.",
      "Creative is 50–70% of results here — real photos of real events at your space beat anything polished.",
      "Local venues should keep audience expansion OFF so budget stays inside your drive radius.",
    ],
  },
  {
    key: "GOOGLE",
    label: "Google Ads",
    emoji: "🔍",
    tagline: "Capture people actively searching \"event venue near me\" — highest intent traffic there is.",
    vertical: ["venue", "rental", "corporate", "wedding"],
    executes: false,
    envKeys: [
      { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token (from Google Ads API Center)" },
      { key: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth Client ID (Google Cloud Console)" },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth Client Secret (Google Cloud Console)" },
    ],
    fields: [
      { key: "loginCustomerId", label: "Login Customer ID", help: "The manager (MCC) account ID making API calls — digits only, no dashes.", required: true },
      { key: "customerId", label: "Customer ID (CID)", help: "The client's own Google Ads account ID — digits only, no dashes.", required: true },
      { key: "refreshToken", label: "OAuth2 Refresh Token", help: "Long-lived token minted through the OAuth consent flow; lets the cron mint fresh access tokens silently.", secret: true, required: true },
    ],
    scopes: [{ scope: "https://www.googleapis.com/auth/adwords", why: "Full Google Ads API access — reporting and campaign management." }],
    gotcha: "The developer token starts in test mode: it only works on test accounts until Google approves Basic access. Apply early — approval takes days.",
    signIn: { possible: true, note: "Google sign-in can mint the refresh token once the OAuth consent screen is verified. Until then, the admin runs the consent flow and pastes the refresh token here." },
    coaching: [
      "Search ads catch people who already want a venue — pair them with Meta, which creates the wanting.",
      "\"Wedding venue [your city]\" and \"corporate event space [your city]\" are the money keywords for venues.",
      "Google rewards landing pages that load fast and match the ad's promise — same page, same words.",
    ],
  },
  {
    key: "TIKTOK",
    label: "TikTok Ads",
    emoji: "🎵",
    tagline: "Nightlife and event hype — where concert and party audiences actually live.",
    vertical: ["concert", "party", "nightlife", "club", "music", "festival"],
    executes: false,
    envKeys: [
      { key: "TIKTOK_CLIENT_KEY", label: "Client Key (TikTok Developer Portal app)" },
      { key: "TIKTOK_CLIENT_SECRET", label: "Client Secret (signs authorization handshakes)" },
    ],
    fields: [
      { key: "accessToken", label: "Access Token", help: "Short-lived token used on marketing endpoints; auto-refreshed by the backend.", secret: true, required: true },
      { key: "refreshToken", label: "Refresh Token", help: "Permanent server-side token that silently mints fresh access tokens.", secret: true, required: true },
      { key: "advertiserId", label: "Advertiser ID", help: "The ad account to run on. After connecting, we list every ad account the profile manages and you pick the right one.", required: true },
      { key: "businessCenterId", label: "Business Center ID (optional)", help: "Only needed when the account belongs to a parent agency or venue-network entity." },
    ],
    scopes: [
      { scope: "ads.readonly", why: "Daily cron polls spend, impressions, and conversions." },
      { scope: "ads.management", why: "The AI creates campaigns, adjusts targeting, pauses weak creative sets." },
      { scope: "video.upload", why: "Uploads raw party/concert clips straight into the TikTok ad asset library." },
    ],
    signIn: { possible: true, note: "TikTok login can authorize the app directly — the client signs in, approves the scopes, and we capture the tokens. Admin can also paste tokens manually." },
    coaching: [
      "TikTok sells energy, not information: 9–15 second clips of packed rooms, drops, and crowd reactions.",
      "Post the raw phone clip over the produced after-movie — authenticity outperforms polish here.",
      "Best for ticketed events with urgency; weakest for slow-consideration wedding decisions.",
    ],
  },
  {
    key: "PINTEREST",
    label: "Pinterest Ads",
    emoji: "📌",
    tagline: "Where weddings are planned — reach couples in the visual-curation phase months before they book.",
    vertical: ["wedding", "ceremony", "reception", "anniversary", "shower", "styled"],
    executes: false,
    envKeys: [
      { key: "PINTEREST_CLIENT_ID", label: "Client ID (Pinterest app fingerprint)" },
      { key: "PINTEREST_CLIENT_SECRET", label: "Client Secret" },
    ],
    fields: [
      { key: "accessToken", label: "Access Token", help: "Standard Bearer token for API calls.", secret: true, required: true },
      { key: "refreshToken", label: "Refresh Token", help: "Long-lived token that keeps offline crons running.", secret: true, required: true },
      { key: "adAccountId", label: "Ad Account ID", help: "Numeric ID of the business billing account (e.g. 549755885175).", required: true },
    ],
    scopes: [
      { scope: "ads:read", why: "Reporting and analytics pulls." },
      { scope: "ads:write", why: "Build campaigns and shuffle creative variations." },
      { scope: "pins:read + pins:write", why: "Venue ads are built on pins — the AI analyzes and drafts the organic pins your wedding ads stand on." },
      { scope: "user_accounts:read", why: "Aligns the connected business profile with your strategy ground truth." },
    ],
    signIn: { possible: true, note: "Pinterest OAuth lets the client sign in and approve directly; tokens land automatically. Admin manual entry works meanwhile." },
    coaching: [
      "Couples pin venues 6–12 months before booking — Pinterest is a long-game lead pipeline, not a quick win.",
      "Boards beat single images: a styled-shoot board of YOUR space in multiple setups is the highest-converting asset.",
      "Seasonal timing matters double here: engagement season (Dec–Feb) is when next year's weddings get pinned.",
    ],
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn Ads",
    emoji: "💼",
    tagline: "The goldmine for mid-week corporate bookings — holiday parties, offsites, and networking mixers.",
    vertical: ["corporate", "conference", "networking", "offsite", "holiday party", "meeting"],
    executes: false,
    envKeys: [
      { key: "LINKEDIN_CLIENT_ID", label: "Client ID (primary application ID)" },
      { key: "LINKEDIN_CLIENT_SECRET", label: "Client Secret (server-side signature)" },
    ],
    fields: [
      { key: "accessToken", label: "Access Token", help: "Bearer header on every API payload.", secret: true, required: true },
      { key: "refreshToken", label: "Refresh Token", help: "Retained to drive automated adjustments.", secret: true, required: true },
      { key: "adAccountUrn", label: "Ad Account URN", help: "Exactly urn:li:sponsoredAccount:{id} — LinkedIn uses URNs, not plain numbers.", required: true },
      { key: "memberUrn", label: "Member URN", help: "urn:li:person:{id} — records which person authorized the connection." },
      { key: "organizationUrn", label: "Organization URN", help: "urn:li:organization:{id} — the venue's company page; required to anchor event ads.", required: true },
    ],
    scopes: [
      { scope: "r_ads", why: "Reads account configuration and verification states." },
      { scope: "rw_ads", why: "Mutates live campaigns, targeting matrices, creative variants." },
      { scope: "r_ads_reporting", why: "The metrics the daily automation needs — impressions, CPC, cost mapping." },
      { scope: "r_organization_admin", why: "Proves the connector has authority to run ads for the venue's official company page." },
    ],
    gotcha: "LinkedIn's Advertising API requires MANUAL approval before marketing scopes work — file the use-case request form in the developer console first, or OAuth fails out of the box.",
    signIn: { possible: true, note: "LinkedIn sign-in works only after the Advertising API application is approved. Until then, admin pastes tokens minted through the approved app." },
    coaching: [
      "Target by job title + company size + geography: \"office managers and executive assistants within 25km\" books holiday parties.",
      "Sept–Oct is when corporate holiday-party budgets get spent — be live before the rush, not during it.",
      "LinkedIn CPCs run 3–5× Meta's; that's fine when one corporate booking is worth thousands. Judge on booking value.",
    ],
  },
];

export function platformSpec(key: string): PlatformSpec | undefined {
  return PLATFORMS.find((p) => p.key === key);
}
