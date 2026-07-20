// Central configuration + invariants for the staging red-team cycle.
// The safety model lives here: prod is a *separate* Supabase project, so the
// only way to reach it is to point the harness at a prod string. We make that
// impossible with an allowlist (targets) + denylist (prod markers), enforced by
// guard.ts before any check runs.

export type Tier = 0 | 1 | 2;

/** Supabase project ref for PRODUCTION — must never appear in a target or DB URL. */
export const PROD_SUPABASE_REF = "ovdpfhexljhotzhrfhrg";

/** Supabase project ref for STAGING — the only DB the cycle is allowed to touch. */
export const STAGING_SUPABASE_REF = "lprydieusipocvsikkqb";

/**
 * Substrings that, if found in a resolved target URL or any DB connection
 * string, abort the run. Add prod custom domains here as they come online.
 */
export const PROD_MARKERS: string[] = [
  PROD_SUPABASE_REF,
  // Add the production Vercel alias / custom domain here, e.g. "ads.yourdomain.com".
];

/**
 * A target host is allowed only if it matches one of these. Vercel *preview*
 * aliases always contain "-git-" (branch previews) or are per-deployment
 * hashes under the personal scope; the PRODUCTION alias never contains
 * "-git-". So requiring "-git-" for any *.vercel.app host structurally
 * excludes prod. localhost is always fine. Extra hosts can be allowed via the
 * REDTEAM_ALLOW_HOSTS env var (comma-separated).
 */
export function isAllowedTargetHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  const extra = (process.env.REDTEAM_ALLOW_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(h)) return true;
  // Vercel preview aliases only: must be a branch/preview deployment, not prod.
  if (h.endsWith(".vercel.app") && h.includes("-git-")) return true;
  return false;
}

/** Containerized scanners — no Windows-native installs, matches CI. */
export const DOCKER_IMAGES = {
  gitleaks: "zricethezav/gitleaks:latest",
  semgrep: "semgrep/semgrep:latest",
  nuclei: "projectdiscovery/nuclei:latest",
  zap: "ghcr.io/zaproxy/zaproxy:stable",
} as const;

/** Semgrep rule packs relevant to a Next.js / TypeScript app. */
export const SEMGREP_CONFIGS = ["p/owasp-top-ten", "p/nextjs", "p/typescript", "p/secrets"];

/** Which checks run at each tier (cumulative). */
export const TIER_CHECKS: Record<Tier, string[]> = {
  0: ["static"],
  1: ["static", "secrets", "sast", "authz"],
  2: ["static", "secrets", "sast", "authz", "ssrf", "dast"],
};

export const TIER_LABEL: Record<Tier, string> = {
  0: "T0 Preflight",
  1: "T1 Standard",
  2: "T2 Full red team",
};

/** Prefix for all synthetic tenants/users the harness creates, so cleanup is unambiguous. */
export const FIXTURE_PREFIX = "zzz-redteam-";
