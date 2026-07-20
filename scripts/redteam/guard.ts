// The single safety gate. run.ts calls assertSafeTarget() before ANY check.
// If anything smells like production, we abort loudly and do nothing.

import { PROD_MARKERS, STAGING_SUPABASE_REF, isAllowedTargetHost } from "./config";

export class ProdGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProdGuardError";
  }
}

/**
 * Aborts unless the target is a known-safe staging/preview/local host AND
 * neither the target nor any provided DB string carries a production marker.
 * @param target  the base URL the dynamic checks will hit
 * @param dbUrls  any DB connection strings in scope (e.g. process.env.DATABASE_URL)
 */
export function assertSafeTarget(target: string, dbUrls: (string | undefined)[] = []): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ProdGuardError(`Target is not a valid URL: ${target}`);
  }

  // 1. Denylist: no production markers anywhere in the target or DB strings.
  const haystacks = [target, ...dbUrls.filter(Boolean)] as string[];
  for (const marker of PROD_MARKERS) {
    for (const hay of haystacks) {
      if (hay.toLowerCase().includes(marker.toLowerCase())) {
        throw new ProdGuardError(
          `ABORT: production marker "${marker}" detected. The red-team cycle refuses to run against production.`,
        );
      }
    }
  }

  // 2. Allowlist: the target host must be explicitly safe.
  if (!isAllowedTargetHost(url.hostname)) {
    throw new ProdGuardError(
      `ABORT: "${url.hostname}" is not an allowed target. Allowed: localhost, a "-git-" Vercel preview alias, or a host in REDTEAM_ALLOW_HOSTS.`,
    );
  }

  // 3. Sanity: if a DB URL is present, it should be the staging project.
  const db = dbUrls.find(Boolean);
  if (db && !db.includes(STAGING_SUPABASE_REF)) {
    throw new ProdGuardError(
      `ABORT: DATABASE_URL does not reference the staging project (${STAGING_SUPABASE_REF}). Refusing to proceed.`,
    );
  }

  return url;
}
