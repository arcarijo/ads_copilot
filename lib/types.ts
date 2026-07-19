// ---------- Meta Marketing API (v25.0) payload types ----------

export type MetaObjective =
  | "OUTCOME_LEADS"
  | "OUTCOME_SALES"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_AWARENESS"
  | "OUTCOME_ENGAGEMENT";

export type EntityStatus = "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

export interface MetaCampaignPayload {
  name: string;
  objective: MetaObjective;
  status: EntityStatus;
  special_ad_categories: string[];
  // Campaign Budget Optimization (CBO) — budget lives at campaign level.
  daily_budget?: number; // minor units (cents)
  lifetime_budget?: number; // minor units (cents)
  bid_strategy?: "LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "LOWEST_COST_WITH_MIN_ROAS";
}

export interface GeoLocations {
  countries?: string[];
  cities?: { key: string; name?: string; radius?: number; distance_unit?: "kilometer" | "mile" }[];
  custom_locations?: { latitude: number; longitude: number; radius: number; distance_unit: "kilometer" }[];
}

export interface MetaTargeting {
  geo_locations: GeoLocations;
  age_min?: number;
  age_max?: number;
  genders?: number[];
  interests?: { id: string; name?: string }[];
  // Custom/Lookalike audience inclusion & exclusion by Meta audience id.
  custom_audiences?: { id: string }[];
  excluded_custom_audiences?: { id: string }[];
  publisher_platforms?: string[]; // omit for Advantage+ dynamic placements
  instagram_positions?: string[];
  facebook_positions?: string[];
  // Advantage+ Audience. false = strict local targeting (no audience creep).
  targeting_automation?: { advantage_audience: 0 | 1 };
}

export interface MetaAdSetPayload {
  name: string;
  campaign_id: string;
  status: EntityStatus;
  billing_event: "IMPRESSIONS";
  optimization_goal: "LEAD_GENERATION" | "LINK_CLICKS" | "OFFSITE_CONVERSIONS" | "REACH" | "LANDING_PAGE_VIEWS";
  targeting: MetaTargeting;
  start_time?: string;
  end_time?: string;
  attribution_spec?: { event_type: "CLICK_THROUGH" | "VIEW_THROUGH"; window_days: number }[];
  promoted_object?: { pixel_id?: string; custom_event_type?: string; page_id?: string };
}

export interface CarouselChildAttachment {
  link: string;
  name?: string;
  description?: string;
  image_hash?: string;
  picture?: string;
}

export interface MetaCreativePayload {
  name: string;
  object_story_spec: {
    page_id: string;
    instagram_actor_id?: string;
    link_data?: {
      link: string;
      message?: string;
      name?: string; // headline
      description?: string;
      image_hash?: string;
      picture?: string;
      call_to_action?: { type: string; value?: { link: string } };
      child_attachments?: CarouselChildAttachment[]; // carousel
    };
    video_data?: {
      video_id: string;
      message?: string;
      title?: string;
      image_url?: string; // thumbnail
      call_to_action?: { type: string; value?: { link: string } };
    };
  };
  degrees_of_freedom_spec?: {
    creative_features_spec?: Record<string, { enroll_status: "OPT_IN" | "OPT_OUT" }>;
  };
}

export interface MetaAdPayload {
  name: string;
  adset_id: string;
  creative: { creative_id: string };
  status: EntityStatus;
}

export interface MetaInsightsRow {
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  frequency?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
  date_start?: string;
  date_stop?: string;
}

export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

export type MetaErrorKind =
  | "BILLING"
  | "ACCOUNT_RESTRICTED"
  | "TOKEN_INVALID"
  | "RATE_LIMIT"
  | "PERMISSION"
  | "VALIDATION"
  | "UNKNOWN";

export class MetaApiError extends Error {
  kind: MetaErrorKind;
  humanMessage: string;
  code?: number;
  subcode?: number;
  raw?: unknown;
  constructor(kind: MetaErrorKind, humanMessage: string, opts: { code?: number; subcode?: number; raw?: unknown } = {}) {
    super(humanMessage);
    this.name = "MetaApiError";
    this.kind = kind;
    this.humanMessage = humanMessage;
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.raw = opts.raw;
  }
}

// ---------- AI plan contract (Copilot output) ----------

export interface CreativeInput {
  kind: "IMAGE" | "CAROUSEL" | "VIDEO";
  label: string;
  filePaths: string[]; // 1 for image/video, 2-10 for carousel
  primaryText?: string;
  headline?: string;
  linkUrl?: string;
}

export interface CopilotPlan {
  campaign: {
    name: string;
    objective: MetaObjective;
    budgetType: "DAILY" | "LIFETIME";
    budgetCents: number;
    bidStrategy: string;
  };
  adSets: {
    name: string;
    optimizationGoal: MetaAdSetPayload["optimization_goal"];
    targeting: MetaTargeting;
    variant?: "A" | "B";
  }[];
  ads: {
    name: string;
    adSetIndex: number;
    creativeLabel: string;
    variant?: "A" | "B";
  }[];
  rationale: string;
}

export interface CopilotResult {
  status: "READY" | "NEEDS_CLARIFICATION";
  questions?: string[];
  plan?: CopilotPlan;
  newMarket?: { detected: boolean; description: string };
}

// ---------- Optimizer contract (Daily cron output) ----------

export type OptimizerAction =
  | { action: "KEEP"; targetId: string; reason: string }
  | { action: "PAUSE_AD"; targetId: string; reason: string }
  | { action: "PAUSE_ADSET"; targetId: string; reason: string }
  | { action: "PAUSE_CAMPAIGN"; targetId: string; reason: string }
  | { action: "RECOMMEND_BUDGET_INCREASE"; targetId: string; reason: string; suggestedDailyBudgetCents?: number };

export interface OptimizerResult {
  summary: string;
  report?: string; // plain-English daily note emailed to the business owner
  actions: OptimizerAction[];
  // Questions only a human with real-world business knowledge can answer,
  // triggered by data patterns the AI cannot diagnose from metrics alone
  // (e.g. high clicks + low conversions → "how fast are inquiries answered?").
  insightRequests?: { question: string; why: string }[];
  // Directive drift: the human's current steering has diverged so far from
  // the campaign's built structure that tuning can't honor it — the campaign
  // needs a rebuild. Informational only; a human decides.
  relaunch?: { needed: boolean; reason: string };
}
