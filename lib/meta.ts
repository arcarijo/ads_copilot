import {
  EntityStatus,
  MetaAdPayload,
  MetaAdSetPayload,
  MetaApiError,
  MetaCampaignPayload,
  MetaCreativePayload,
  MetaErrorBody,
  MetaErrorKind,
  MetaInsightsRow,
} from "./types";
import { assertBudgetAllowed } from "./guardrails";

const API_VERSION = "v25.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Per-tenant Meta credentials. Falls back to env vars for legacy campaigns. */
export interface MetaCreds {
  token: string;
  accountId: string; // numeric, without "act_" prefix
  pageId?: string;
}

export function credsFromClient(client: {
  metaAccessToken: string;
  metaAdAccountId: string;
  metaPageId: string;
}): MetaCreds {
  return {
    token: client.metaAccessToken,
    accountId: client.metaAdAccountId.replace(/^act_/, ""),
    pageId: client.metaPageId,
  };
}

export function envCreds(): MetaCreds {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!token || token.startsWith("your_") || !account || account.includes("your_")) {
    throw new MetaApiError(
      "TOKEN_INVALID",
      "No Meta credentials available. Attach this campaign to an onboarded client, or set META_ACCESS_TOKEN / META_AD_ACCOUNT_ID in .env.local."
    );
  }
  return { token, accountId: account.replace(/^act_/, "") };
}

/** Maps a raw Graph API error body to a typed, human-readable error. */
export function classifyMetaError(status: number, body: MetaErrorBody): MetaApiError {
  const e = body.error ?? {};
  const msg = `${e.message ?? ""} ${e.error_user_msg ?? ""}`.toLowerCase();
  const code = e.code;
  const subcode = e.error_subcode;

  let kind: MetaErrorKind = "UNKNOWN";
  let human = e.error_user_msg || e.message || `Meta API request failed (HTTP ${status}).`;

  if (/payment|billing|funding|credit card|card was declined|unsettled|prepay/.test(msg) || subcode === 1359188) {
    kind = "BILLING";
    human =
      "Meta billing problem: the payment method could not be processed (card declined, expired, or unsettled balance). Fix billing in Meta Ads Manager, then retry — no campaign changes were made.";
  } else if (/account.*(disabled|restricted|closed)|ad account is not active/.test(msg) || code === 2635) {
    kind = "ACCOUNT_RESTRICTED";
    human =
      "The Meta ad account is restricted or disabled. Resolve the restriction in Meta Business Manager before launching campaigns.";
  } else if (code === 190 || /access token|session has expired|not authorized/.test(msg)) {
    kind = "TOKEN_INVALID";
    human = "Meta access token is invalid or expired. Generate a new system-user token for this client.";
  } else if (code === 17 || code === 4 || code === 32 || code === 613) {
    kind = "RATE_LIMIT";
    human = "Meta API rate limit reached. The system will retry on the next cycle.";
  } else if (/custom audience terms|terms of service.*custom audience|custom audience.*terms of service|tos.*custom audience/.test(msg)) {
    kind = "TOS_REQUIRED";
    human =
      "This ad account hasn't accepted Meta's Custom Audience Terms of Service yet. Have the account owner accept them at business.facebook.com/ads/manage/customaudiences/tos, then retry — no campaign changes were made.";
  } else if (code === 200 || code === 10 || e.type === "OAuthException") {
    kind = "PERMISSION";
    human = `Meta permission error: ${e.message ?? "missing ads_management permission on this token."}`;
  } else if (code === 100) {
    kind = "VALIDATION";
    human = `Meta rejected the payload: ${e.error_user_msg ?? e.message ?? "invalid parameter."}`;
  }

  return new MetaApiError(kind, human, { code, subcode, raw: body });
}

async function metaFetch<T>(
  creds: MetaCreds,
  path: string,
  opts: { method?: "GET" | "POST"; params?: Record<string, string>; body?: Record<string, unknown> } = {}
): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", creds.token);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);

  const init: RequestInit = { method: opts.method ?? "GET" };
  if (opts.body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.body)) {
      if (v === undefined || v === null) continue;
      form.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    init.method = "POST";
    init.body = form;
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new MetaApiError("UNKNOWN", "Meta API request timed out after 10s. Meta may be degraded — try again shortly.");
    }
    throw err;
  }
  const json = (await res.json().catch(() => ({}))) as T & MetaErrorBody;
  if (!res.ok || (json as MetaErrorBody).error) {
    throw classifyMetaError(res.status, json as MetaErrorBody);
  }
  return json;
}

// ---------- Create ----------

export async function createCampaign(creds: MetaCreds, payload: MetaCampaignPayload): Promise<string> {
  if (payload.daily_budget) assertBudgetAllowed(payload.daily_budget, "DAILY");
  if (payload.lifetime_budget) assertBudgetAllowed(payload.lifetime_budget, "LIFETIME");
  const res = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/campaigns`, {
    body: { ...payload, special_ad_categories: payload.special_ad_categories ?? [] },
  });
  return res.id;
}

export async function createAdSet(creds: MetaCreds, payload: MetaAdSetPayload): Promise<string> {
  const res = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/adsets`, { body: { ...payload } });
  return res.id;
}

export async function createAdCreative(creds: MetaCreds, payload: MetaCreativePayload): Promise<string> {
  const res = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/adcreatives`, { body: { ...payload } });
  return res.id;
}

/**
 * Upload a video to Meta by URL (e.g. a normalized Google Drive direct link).
 * Meta fetches and hosts it; we store nothing. Returns the Meta video id.
 * Note: Meta processes video async — the id is usable for creative creation,
 * but very large files may still be transcoding briefly after this returns.
 */
export async function uploadVideoFromUrl(creds: MetaCreds, fileUrl: string): Promise<string> {
  const res = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/advideos`, {
    body: { file_url: fileUrl },
  });
  return res.id;
}

export async function createAd(creds: MetaCreds, payload: MetaAdPayload): Promise<string> {
  const res = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/ads`, { body: { ...payload } });
  return res.id;
}

// ---------- Mutate ----------

export async function setEntityStatus(creds: MetaCreds, entityId: string, status: EntityStatus): Promise<void> {
  await metaFetch(creds, `${entityId}`, { body: { status } });
}

export const pauseEntity = (creds: MetaCreds, id: string) => setEntityStatus(creds, id, "PAUSED");

// ---------- Read ----------

// ---------- Audiences ----------

/**
 * Resolve a plain-English interest ("wedding planning") to Meta's real
 * targeting catalog via the Targeting Search API. Interests deprecate
 * periodically, so IDs must always come from here, never invented.
 */
export async function searchInterests(
  creds: MetaCreds,
  query: string
): Promise<{ id: string; name: string; audience_size_lower_bound?: number }[]> {
  const json = await metaFetch<{ data: { id: string; name: string; audience_size_lower_bound?: number }[] }>(
    creds,
    "search",
    { params: { type: "adinterest", q: query, limit: "8" } }
  );
  return json.data ?? [];
}

/**
 * What audiences ALREADY live on the ad account — so owners see reality on
 * Meta, not just what this app created. Read-only.
 */
export async function listRemoteAudiences(
  creds: MetaCreds
): Promise<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number; time_updated?: string }[]> {
  const json = await metaFetch<{
    data: { id: string; name: string; subtype?: string; approximate_count_lower_bound?: number; time_updated?: string }[];
  }>(creds, `act_${creds.accountId}/customaudiences`, {
    params: { fields: "id,name,subtype,approximate_count_lower_bound,time_updated", limit: "50" },
  });
  return json.data ?? [];
}

/** Create a Custom Audience shell (CUSTOM subtype, customer-list source). */
export async function createCustomAudience(
  creds: MetaCreds,
  input: { name: string; description?: string }
): Promise<string> {
  const json = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/customaudiences`, {
    body: {
      name: input.name,
      description: input.description ?? "",
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
    },
  });
  return json.id;
}

/**
 * Upload hashed customer identifiers into a Custom Audience. `data` rows must
 * already be SHA-256 hashes of normalized values, column-aligned with schema.
 */
export async function addUsersToCustomAudience(
  creds: MetaCreds,
  audienceId: string,
  schema: ("EMAIL" | "PHONE")[],
  data: string[][]
): Promise<{ received: number; invalid: number }> {
  const json = await metaFetch<{ num_received?: number; num_invalid_entries?: number }>(creds, `${audienceId}/users`, {
    body: { payload: { schema, data } },
  });
  return { received: json.num_received ?? data.length, invalid: json.num_invalid_entries ?? 0 };
}

/** Create an engagement Custom Audience (people who interacted with the Page). */
export async function createEngagementAudience(
  creds: MetaCreds,
  input: { name: string; description?: string; retentionDays: number }
): Promise<string> {
  const pageId = creds.pageId;
  if (!pageId) throw new Error("A Facebook Page id is required for engagement audiences.");
  const json = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/customaudiences`, {
    body: {
      name: input.name,
      description: input.description ?? "",
      subtype: "ENGAGEMENT",
      rule: {
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: pageId, type: "page" }],
              retention_seconds: input.retentionDays * 86_400,
              filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "page_engaged" }] },
            },
          ],
        },
      },
    },
  });
  return json.id;
}

/** Create a Lookalike from an origin audience (ratio 0.01–0.20). */
export async function createLookalikeAudience(
  creds: MetaCreds,
  input: { name: string; originAudienceId: string; country: string; ratio: number }
): Promise<string> {
  const ratio = Math.min(0.2, Math.max(0.01, input.ratio));
  const json = await metaFetch<{ id: string }>(creds, `act_${creds.accountId}/customaudiences`, {
    body: {
      name: input.name,
      subtype: "LOOKALIKE",
      origin_audience_id: input.originAudienceId,
      lookalike_spec: { type: "similarity", ratio, country: input.country },
    },
  });
  return json.id;
}

export async function getInsights(
  creds: MetaCreds,
  entityId: string,
  opts: { since: string; until: string; level?: "campaign" | "adset" | "ad" }
): Promise<MetaInsightsRow[]> {
  const res = await metaFetch<{ data: MetaInsightsRow[] }>(creds, `${entityId}/insights`, {
    params: {
      level: opts.level ?? "ad",
      time_range: JSON.stringify({ since: opts.since, until: opts.until }),
      fields:
        "campaign_id,adset_id,ad_id,ad_name,spend,impressions,clicks,ctr,cpm,frequency,actions,cost_per_action_type,date_start,date_stop",
    },
  });
  return res.data ?? [];
}

// ---------- Credential verification (onboarding readiness check) ----------

export interface VerifyCheck {
  item: string;
  ok: boolean;
  detail: string;
}

/**
 * Readiness probe used by the onboarding form and preflight: token validity,
 * ad account status, funding source, Page access, Instagram access, Custom
 * Audience TOS acceptance, and a validate_only write-permission check.
 * Nothing is ever persisted to Meta — the campaign-create probe uses
 * execution_options: ["validate_only"], which runs full permission
 * enforcement without creating anything, and the TOS probe is a plain GET.
 */
export async function verifyCredentials(creds: MetaCreds): Promise<{ ready: boolean; checks: VerifyCheck[] }> {
  // The account/page/ad-creation-permission/TOS probes are independent Graph
  // API calls — run them concurrently instead of in series so total latency
  // stays well under the function timeout. Only the Instagram check is
  // sequential, since it needs the page's linked IG id from the page probe.
  const [accountChecks, pageChecks, adPermissionCheck, tosCheck] = await Promise.all([
    verifyAccount(creds),
    verifyPage(creds),
    verifyAdCreationPermission(creds),
    verifyCustomAudienceTos(creds),
  ]);

  const checks = [...accountChecks, ...pageChecks, adPermissionCheck, tosCheck];
  return { ready: checks.every((c) => c.ok), checks };
}

// campaign-create validate_only doesn't exercise the Custom Audience gate at
// all (it's scoped to the customaudiences endpoint, not campaigns), so a
// client who hasn't accepted the Custom Audience TOS previously looked fully
// "ready" until launch, when createCustomAudience failed reactively. This is
// a plain read (`GET .../customaudiencestos`) — undocumented field shape, but
// every third-party integration observed treats a populated `data` array as
// "accepted" and empty as "not yet accepted," so that's the contract here too.
async function verifyCustomAudienceTos(creds: MetaCreds): Promise<VerifyCheck> {
  try {
    const json = await metaFetch<{ data?: unknown[] }>(creds, `act_${creds.accountId}/customaudiencestos`);
    const accepted = (json.data?.length ?? 0) > 0;
    return {
      item: "Custom Audience Terms of Service",
      ok: accepted,
      detail: accepted
        ? "Custom Audience Terms of Service accepted for this ad account."
        : `Custom Audience Terms of Service not yet accepted. Accept them at business.facebook.com/ads/manage/customaudiences/tos/?act=${creds.accountId} before launching any campaign that targets a Custom Audience.`,
    };
  } catch (err) {
    const m = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    return { item: "Custom Audience Terms of Service", ok: false, detail: `Could not check Custom Audience TOS status: ${m}` };
  }
}

async function verifyAccount(creds: MetaCreds): Promise<VerifyCheck[]> {
  try {
    const acct = await metaFetch<{
      name?: string;
      account_status?: number;
      currency?: string;
      funding_source?: string;
      funding_source_details?: { id?: string; display_string?: string; type?: number };
    }>(creds, `act_${creds.accountId}`, {
      params: { fields: "name,account_status,currency,funding_source,funding_source_details" },
    });
    const statusMap: Record<number, string> = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 9: "IN_GRACE_PERIOD", 101: "CLOSED" };
    const statusName = statusMap[acct.account_status ?? 0] ?? `code ${acct.account_status}`;
    // A funding source is signalled by either the id, a display string, or the
    // legacy numeric funding_source. A card in the Business but not assigned to
    // THIS ad account will leave all of these empty.
    const fundingLabel = acct.funding_source_details?.display_string;
    const hasFunding = Boolean(fundingLabel || acct.funding_source_details?.id || acct.funding_source);
    return [
      { item: "Access token", ok: true, detail: "Token accepted by Graph API." },
      {
        item: "Ad account status",
        ok: acct.account_status === 1,
        detail: `${acct.name ?? "account"} (${acct.currency ?? "?"}) — ${statusName}`,
      },
      {
        item: "Funding source",
        ok: hasFunding,
        detail: hasFunding
          ? `${fundingLabel ?? "Payment method assigned"} (funding id ${acct.funding_source ?? acct.funding_source_details?.id}).`
          : "No payment method is assigned to THIS ad account. A card added to the Business must still be set as this ad account's funding source: Meta Ads Manager → Billing & payment settings → select this ad account → Add/assign payment method. (Meta will also reject launch until this is done.)",
      },
    ];
  } catch (err) {
    const m = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    return [{ item: "Access token / ad account", ok: false, detail: m }];
  }
}

async function verifyPage(creds: MetaCreds): Promise<VerifyCheck[]> {
  if (!creds.pageId) {
    return [{ item: "Facebook Page access", ok: false, detail: "No Page ID provided." }];
  }
  let pageName: string | undefined;
  try {
    const page = await metaFetch<{ name?: string }>(creds, creds.pageId, { params: { fields: "name" } });
    pageName = page.name;
  } catch (err) {
    const m = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    return [{ item: "Facebook Page access", ok: false, detail: m }];
  }
  const checks: VerifyCheck[] = [
    { item: "Facebook Page access", ok: true, detail: `Page "${pageName}" reachable with this token.` },
  ];

  try {
    // Fetched separately from the name above: a token missing IG-specific
    // permissions gets error #100 ("nonexisting field") on this field alone,
    // which previously failed the whole request and got mislabeled as a
    // Page-access problem instead of an Instagram-permission one.
    const page = await metaFetch<{ instagram_business_account?: { id: string } }>(creds, creds.pageId, {
      params: { fields: "instagram_business_account" },
    });

    // A Page can have Instagram placements without the token having access to
    // that IG account specifically — Page access alone does not imply this,
    // and was the exact gap that let a client's launch fail after "VERIFIED".
    const igId = page.instagram_business_account?.id;
    if (igId) {
      try {
        const ig = await metaFetch<{ username?: string }>(creds, igId, { params: { fields: "username" } });
        checks.push({ item: "Instagram account access", ok: true, detail: `Instagram @${ig.username ?? "account"} reachable — ads can publish to Instagram placements.` });
      } catch (err) {
        const m = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
        checks.push({
          item: "Instagram account access",
          ok: false,
          detail: `This Page has a linked Instagram account, but the token can't access it: ${m}. In Meta Business Settings, grant the system user access under Accounts → Instagram accounts (Page access alone does not cover it).`,
        });
      }
    }
    return checks;
  } catch (err) {
    const m = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    checks.push({
      item: "Instagram account access",
      ok: false,
      detail: `Could not check this Page's linked Instagram account: ${m}. In Meta Business Settings, grant the system user access under Accounts → Instagram accounts.`,
    });
    return checks;
  }
}

// Live write-permission probe. The account/page checks above are all
// read-only GETs and succeed even when the token lacks ads_management —
// validate_only runs the ad account through the same permission enforcement a
// real launch does, without creating anything, so a missing/partial grant
// surfaces here instead of only at "Approve & Launch".
async function verifyAdCreationPermission(creds: MetaCreds): Promise<VerifyCheck> {
  try {
    await metaFetch<{ id?: string; success?: boolean }>(creds, `act_${creds.accountId}/campaigns`, {
      body: {
        name: "Copilot readiness check (validate only — nothing is created)",
        objective: "OUTCOME_TRAFFIC",
        status: "PAUSED",
        special_ad_categories: [],
        execution_options: ["validate_only"],
      },
    });
    return { item: "Ad creation permission", ok: true, detail: "Token can create campaigns on this ad account (validated only — nothing was created)." };
  } catch (err) {
    const m = err instanceof MetaApiError ? err.humanMessage : (err as Error).message;
    return { item: "Ad creation permission", ok: false, detail: `Token cannot create ads on this account: ${m}` };
  }
}
