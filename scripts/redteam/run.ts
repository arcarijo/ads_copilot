// Orchestrator for the staging red-team cycle.
//
//   npx tsx scripts/redteam/run.ts --tier=1 --target=https://<preview>.vercel.app
//
// Order of operations, always:
//   1. Load .env.redteam (secrets stay out of the shell / git).
//   2. GUARD: assertSafeTarget — abort on any production marker or non-allowed host.
//   3. Set up fixtures (only when a dynamic check needs them).
//   4. Run the tier's checks; collect results.
//   5. Tear down fixtures; write the go/no-go report; exit 1 on any FAIL.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSafeTarget, ProdGuardError } from "./guard";
import { TIER_CHECKS, TIER_LABEL, type Tier } from "./config";
import { setupFixtures, type Fixtures } from "./lib/fixtures";
import { writeReport, printSummary } from "./lib/report";
import type { Check, CheckResult, RunContext } from "./types";

import { staticCheck } from "./checks/static";
import { secretsCheck } from "./checks/secrets";
import { sastCheck } from "./checks/sast";
import { authzCheck } from "./checks/authz";
import { ssrfCheck } from "./checks/ssrf";
import { dastCheck } from "./checks/dast";

const REGISTRY: Record<string, Check> = {
  static: staticCheck,
  secrets: secretsCheck,
  sast: sastCheck,
  authz: authzCheck,
  ssrf: ssrfCheck,
  dast: dastCheck,
};

/** Minimal .env parser — no dependency; KEY=VALUE lines, ignores # and blanks. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

async function main() {
  const repoRoot = resolve(import.meta.dirname, "../..");
  loadEnvFile(resolve(repoRoot, ".env.redteam"));

  const tier = Number(arg("tier", "1")) as Tier;
  if (![0, 1, 2].includes(tier)) throw new Error(`Invalid --tier=${tier} (use 0, 1, or 2).`);
  const target = arg("target", process.env.REDTEAM_TARGET) ?? "";

  // Static checks need no target. Dynamic checks (authz/dast) do — when no
  // target is supplied they SKIP cleanly, so the full suite still runs offline
  // as a static security pass. A supplied target is always guarded.
  const checkNames = TIER_CHECKS[tier];
  const TARGET_CHECKS = new Set(["authz", "dast"]);

  if (target) {
    assertSafeTarget(target, [process.env.DATABASE_URL]); // throws ProdGuardError on anything prod-shaped
  } else if (checkNames.some((c) => TARGET_CHECKS.has(c))) {
    console.warn("  ⚠ no --target supplied — dynamic checks (authz/dast) will be skipped (static pass only).");
  }

  console.log(`\n▶ ${TIER_LABEL[tier]} — target: ${target || "(static only)"}`);
  console.log(`  checks: ${checkNames.join(", ")}\n`);

  // Fixtures (incl. Clerk session tokens, which expire in ~60s) are minted
  // just-in-time, immediately before the authz check runs — not upfront —
  // so slower preceding checks (sast can take 100s+) can't let them expire.
  let fixtures: Fixtures | undefined;

  const ctx: RunContext = {
    tier,
    target,
    repoRoot,
    bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    adminToken: undefined,
    adminUserId: undefined,
    memberToken: undefined,
    memberUserId: undefined,
    memberClientId: undefined,
    otherClientId: undefined,
  };

  const results: CheckResult[] = [];
  for (const name of checkNames) {
    if (TARGET_CHECKS.has(name) && !target) {
      results.push({
        name,
        status: "SKIP",
        findings: [{ status: "SKIP", title: `${name} skipped — no target (static pass)` }],
        durationMs: 0,
      });
      continue;
    }
    if (name === "authz" && target) {
      try {
        console.log("  setting up fixtures (staging tenants + Clerk sessions)…");
        fixtures = await setupFixtures();
        ctx.adminToken = fixtures.adminToken;
        ctx.adminUserId = fixtures.adminUserId;
        ctx.memberToken = fixtures.memberToken;
        ctx.memberUserId = fixtures.memberUserId;
        ctx.memberClientId = fixtures.memberClientId;
        ctx.otherClientId = fixtures.otherClientId;
      } catch (e) {
        console.warn(`  ⚠ fixtures unavailable — authz will be skipped: ${(e as Error).message}`);
      }
    }
    console.log(`  ▸ running ${name}…`);
    try {
      results.push(await REGISTRY[name](ctx));
    } catch (e) {
      results.push({
        name,
        status: "FAIL",
        findings: [{ status: "FAIL", title: `${name} crashed`, detail: (e as Error).message }],
        durationMs: 0,
        error: (e as Error).message,
      });
    }
  }

  if (fixtures) {
    console.log("  tearing down fixtures…");
    await fixtures.teardown().catch((e) => console.warn(`  ⚠ teardown issue: ${(e as Error).message}`));
  }

  const report = writeReport(results, { tier, target: target || "(static only)", reportDir: resolve(repoRoot, "scripts/redteam/report") });
  printSummary(results, report);
  process.exit(report.verdict === "NO-GO" ? 1 : 0);
}

main().catch((e) => {
  if (e instanceof ProdGuardError) {
    console.error(`\n🛑 ${e.message}\n`);
    process.exit(2);
  }
  console.error(e);
  process.exit(3);
});
