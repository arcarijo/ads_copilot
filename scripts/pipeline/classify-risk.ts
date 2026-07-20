// Diff-based risk classifier. Reads the files changed vs a base ref and prints
// the red-team tier the change warrants (highest match wins), plus a reason.
// In GitHub Actions it also writes `tier=`/`reason=` to $GITHUB_OUTPUT and a
// `RISK_LABEL` override (risk:high|med|low) can force the tier.
//
//   npx tsx scripts/pipeline/classify-risk.ts --base=origin/main
//
// Exit code is always 0 (classification is advisory, not a gate).

import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";

type Tier = 0 | 1 | 2;

// Highest matching tier wins. Patterns are tested against each changed path.
const RULES: { tier: Tier; test: RegExp; why: string }[] = [
  { tier: 2, test: /^middleware\.ts$/, why: "edge auth gate" },
  { tier: 2, test: /^lib\/(auth|clerk|crypto)/, why: "auth/identity/crypto core" },
  { tier: 2, test: /^app\/api\/(admin|users)\//, why: "admin/user API surface" },
  { tier: 2, test: /^prisma\//, why: "database schema" },
  { tier: 1, test: /^app\/api\//, why: "API route" },
  { tier: 1, test: /^lib\//, why: "shared library code" },
  { tier: 0, test: /.*/, why: "UI/content/docs only" },
];

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

function changedFiles(base: string): string[] {
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function labelOverride(): Tier | null {
  const l = (process.env.RISK_LABEL ?? "").toLowerCase();
  if (l.includes("risk:high")) return 2;
  if (l.includes("risk:med")) return 1;
  if (l.includes("risk:low")) return 0;
  return null;
}

function classify(files: string[]): { tier: Tier; reason: string } {
  if (files.length === 0) return { tier: 0, reason: "no changed files detected" };
  let best: Tier = 0;
  const reasons = new Set<string>();
  for (const f of files) {
    for (const r of RULES) {
      if (r.test.test(f)) {
        if (r.tier > best) best = r.tier;
        if (r.tier >= 1) reasons.add(`${f} → ${r.why}`);
        break;
      }
    }
  }
  const reason = best === 0 ? "UI/content/docs only" : [...reasons].slice(0, 6).join("; ");
  return { tier: best, reason };
}

function main() {
  const base = arg("base", "origin/main");
  const files = changedFiles(base);
  const override = labelOverride();
  const auto = classify(files);
  const tier = override ?? auto.tier;
  const reason = override !== null ? `label override (auto was T${auto.tier}): ${auto.reason}` : auto.reason;

  console.log(`tier=${tier}`);
  console.log(`reason=${reason}`);
  console.log(`files=${files.length}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tier=${tier}\nreason=${reason}\n`);
  }
}

main();
