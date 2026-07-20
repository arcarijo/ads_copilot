// Renders the run into a go/no-go report (markdown + JSON) and a terminal
// summary. Overall verdict: NO-GO if any check FAILed, GO otherwise.

import { writeFileSync } from "node:fs";
import type { CheckResult, Status } from "../types";
import { TIER_LABEL } from "../config";

const ICON: Record<Status, string> = { PASS: "✅", FAIL: "❌", WARN: "⚠️", SKIP: "➖" };

export interface Report {
  verdict: "GO" | "NO-GO";
  markdownPath: string;
  jsonPath: string;
}

export function writeReport(
  results: CheckResult[],
  meta: { tier: 0 | 1 | 2; target: string; reportDir: string },
): Report {
  const failed = results.some((r) => r.status === "FAIL");
  const verdict: "GO" | "NO-GO" = failed ? "NO-GO" : "GO";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const md: string[] = [
    `# Red-Team Report — ${verdict}`,
    ``,
    `- **Tier:** ${TIER_LABEL[meta.tier]}`,
    `- **Target:** ${meta.target}`,
    `- **When:** ${new Date().toISOString()}`,
    ``,
    `| Check | Result | Time |`,
    `| --- | --- | --- |`,
    ...results.map((r) => `| ${r.name} | ${ICON[r.status]} ${r.status} | ${(r.durationMs / 1000).toFixed(1)}s |`),
    ``,
  ];

  for (const r of results) {
    md.push(`## ${ICON[r.status]} ${r.name}`);
    if (r.error) md.push(`> error: ${r.error}`);
    for (const f of r.findings) {
      md.push(`- ${ICON[f.status]} **${f.title}**`);
      if (f.detail) md.push(`  \n  \`\`\`\n  ${f.detail.replace(/\n/g, "\n  ")}\n  \`\`\``);
    }
    md.push(``);
  }

  const markdownPath = `${meta.reportDir}/report-${stamp}.md`;
  const jsonPath = `${meta.reportDir}/report-${stamp}.json`;
  writeFileSync(markdownPath, md.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify({ verdict, ...meta, results }, null, 2), "utf8");

  return { verdict, markdownPath, jsonPath };
}

/** Compact terminal summary. */
export function printSummary(results: CheckResult[], report: Report): void {
  console.log("\n──────── Red-Team Summary ────────");
  for (const r of results) {
    console.log(`${ICON[r.status]} ${r.name.padEnd(10)} ${r.status}`);
    for (const f of r.findings.filter((x) => x.status === "FAIL" || x.status === "WARN")) {
      console.log(`    ${ICON[f.status]} ${f.title}`);
    }
  }
  console.log("──────────────────────────────────");
  console.log(`Verdict: ${report.verdict === "GO" ? "✅ GO" : "❌ NO-GO"}`);
  console.log(`Report:  ${report.markdownPath}\n`);
}
