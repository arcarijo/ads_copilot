// Edge-safe session tokens (no Prisma, no Node-only imports — the middleware
// runs this in the edge runtime). Format: "v2.<role>.<userId>.<exp>.<hmac>"
// where exp is a unix-seconds expiry baked into the signed payload — a stolen
// cookie dies at exp no matter what the browser does. Rotating the signing
// secret invalidates every session. v1 (no-expiry) tokens are rejected.

export type Session = { role: "admin" } | { role: "user"; userId: string };

/** Session lifetime: 30 days, enforced server-side via the signed exp claim. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Signing key for session cookies. Prefer a dedicated SESSION_SECRET so the
 * admin login password never doubles as key material; fall back to
 * ADMIN_PASSWORD for deployments that predate the split.
 */
export function sessionSecret(): string | undefined {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
}

const VERSION = "v2";

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const userId = session.role === "user" ? session.userId : "";
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${VERSION}.${session.role}.${userId}.${exp}`;
  return `${payload}.${await hmacHex(payload, secret)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [version, role, userId, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const payload = `${version}.${role}.${userId}.${exp}`;
  const expected = await hmacHex(payload, secret);
  // Constant-time-ish comparison (both are fixed-length hex of equal size).
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  if (role === "admin") return { role: "admin" };
  if (role === "user" && userId) return { role: "user", userId };
  return null;
}
