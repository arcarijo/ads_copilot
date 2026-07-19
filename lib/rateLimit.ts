// Minimal in-memory sliding-window rate limiter for brute-force protection.
// Per-instance only (Vercel Fluid Compute reuses instances, so this bites in
// practice), zero dependencies, no PII persisted. For hard guarantees at
// scale, swap for a durable store — for a passcode login form this raises the
// cost of online guessing by orders of magnitude.
import type { Session } from "./session";

const buckets = new Map<string, number[]>();

/** True when `key` has exceeded `max` hits within the last `windowMs`. Records the hit. */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return hits.length > max;
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/**
 * Per-principal throttle for expensive AI endpoints (each burns a Cloudflare
 * Workers AI 70B inference). Keyed by user id — NOT a shared global counter —
 * so one abusive tenant can never rate-limit everyone else (that shared-fate
 * pattern is itself a DoS). Best-effort per-instance; pairs with the durable
 * daily caps (research) and the capacity monitor for defense in depth.
 * Returns true when the caller has exceeded 15 heavy AI calls in 5 minutes.
 */
export function aiRateLimited(session: Session, headers: Headers): boolean {
  const key = session.role === "user" ? `ai:u:${session.userId}` : `ai:admin:${clientIp(headers)}`;
  return rateLimited(key, 15, 5 * 60 * 1000);
}
