// Application-layer encryption for secrets at rest (Meta tokens, platform
// credentials). AES-256-GCM keyed by CREDS_SECRET. Values are stored as
// "enc:v1:<iv b64>:<ciphertext+tag b64>"; anything without that prefix is
// treated as legacy plaintext and returned as-is, so existing rows keep
// working and get encrypted transparently on their next write.
//
// CREDS_SECRET must NEVER be rotated casually — it decrypts stored data and
// also peppers user passcode hashes. Node-only (route handlers / server
// components); the edge middleware never touches encrypted columns.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";

/** Constant-time string equality (hashes first, so lengths may differ). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const secret = process.env.CREDS_SECRET;
  if (!secret) return null;
  // Accept any string secret; derive a uniform 32-byte key.
  return createHash("sha256").update(secret, "utf8").digest();
}

let warned = false;

/** Encrypt a secret for storage. Without CREDS_SECRET, stores plaintext (warns once). */
export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) {
    if (!warned) {
      warned = true;
      console.warn("[crypto] CREDS_SECRET is not set — storing credentials UNENCRYPTED.");
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${iv.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a stored secret. Legacy plaintext (no prefix) passes through unchanged. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error("CREDS_SECRET is required to decrypt stored credentials but is not set.");
  const [ivB64, ctB64] = stored.slice(PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const blob = Buffer.from(ctB64, "base64");
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

