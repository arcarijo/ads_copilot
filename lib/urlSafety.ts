// SSRF guard for outbound fetches of user-supplied URLs (research crawler).
// Prisma-free and side-effect-free so it can be unit-tested in isolation.
// Only public http(s) hosts pass — no localhost, IP literals, or link-local
// metadata endpoints reachable from the serverless network.
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  // IPv6 literals: forbid outright (public sites use hostnames).
  if (host.includes(":")) return false;
  // IPv4 literals: forbid loopback/private/link-local/metadata ranges — and
  // since public sites are always named, just forbid all IP literals.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}
