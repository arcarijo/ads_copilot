// Tier 0: static gates that need no running app. Type safety, unit tests, and
// the dependency audit. Reasoning-based review (native /security-review, ToB
// differential-review) is run conversationally by Claude, not here.

import { exec } from "../lib/exec";
import type { Check, Finding } from "../types";
import { worst } from "../types";

export const staticCheck: Check = async (ctx) => {
  const start = Date.now();
  const findings: Finding[] = [];

  // TypeScript
  const tsc = await exec("npx", ["--yes", "tsc", "--noEmit"], { cwd: ctx.repoRoot, timeoutMs: 180_000, shell: true });
  findings.push({
    status: tsc.code === 0 ? "PASS" : "FAIL",
    title: "TypeScript compiles (tsc --noEmit)",
    detail: tsc.code === 0 ? undefined : tsc.stdout.slice(-2000) || tsc.stderr.slice(-2000),
  });

  // Unit tests
  const vitest = await exec("npx", ["--yes", "vitest", "run"], { cwd: ctx.repoRoot, timeoutMs: 180_000, shell: true });
  findings.push({
    status: vitest.code === 0 ? "PASS" : "FAIL",
    title: "Unit tests pass (vitest run)",
    detail: vitest.code === 0 ? undefined : vitest.stdout.slice(-2000) || vitest.stderr.slice(-2000),
  });

  // Dependency audit — high/critical only.
  const audit = await exec("npm", ["audit", "--audit-level=high", "--json"], {
    cwd: ctx.repoRoot,
    timeoutMs: 120_000,
    shell: true,
  });
  let auditFinding: Finding = { status: "PASS", title: "npm audit (no high/critical advisories)" };
  try {
    const parsed = JSON.parse(audit.stdout);
    const meta = parsed?.metadata?.vulnerabilities ?? {};
    const high = (meta.high ?? 0) + (meta.critical ?? 0);
    if (high > 0) {
      auditFinding = {
        status: "FAIL",
        title: `npm audit: ${high} high/critical advisory(ies)`,
        detail: JSON.stringify(meta),
      };
    }
  } catch {
    auditFinding = { status: "WARN", title: "npm audit output unparseable", detail: audit.stderr.slice(-500) };
  }
  findings.push(auditFinding);

  return { name: "static", status: worst(findings), findings, durationMs: Date.now() - start };
};
