// Tier 1: deterministic SAST with Semgrep (containerized) using OWASP / Next.js
// / TypeScript rule packs. This is the always-on baseline; Claude's reasoning
// reviewers (ToB `semgrep`, `differential-review`) run on top for logic bugs.

import { exec, dockerMount } from "../lib/exec";
import { DOCKER_IMAGES, SEMGREP_CONFIGS } from "../config";
import type { Check, Finding } from "../types";
import { worst } from "../types";

interface SemgrepResult {
  results?: { check_id: string; path: string; start: { line: number }; extra?: { severity?: string } }[];
  errors?: unknown[];
}

export const sastCheck: Check = async (ctx) => {
  const start = Date.now();
  const mount = dockerMount(ctx.repoRoot);
  const configArgs = SEMGREP_CONFIGS.flatMap((c) => ["--config", c]);

  const res = await exec(
    "docker",
    [
      "run", "--rm", "-v", `${mount}:/src`, DOCKER_IMAGES.semgrep,
      "semgrep", "scan", ...configArgs,
      "--json", "--quiet", "--metrics=off",
      "--exclude", "scripts/redteam", "--exclude", "node_modules", "--exclude", ".next",
      "--exclude", ".claude", "--exclude", "docs", "--exclude", ".agents",
    ],
    { cwd: ctx.repoRoot, timeoutMs: 300_000 },
  );

  let findings: Finding[] = [];
  try {
    const parsed = JSON.parse(res.stdout) as SemgrepResult;
    const results = parsed.results ?? [];
    const errorsHigh = results.filter((r) => (r.extra?.severity ?? "").toUpperCase() === "ERROR");
    const warns = results.filter((r) => (r.extra?.severity ?? "").toUpperCase() === "WARNING");

    if (errorsHigh.length) {
      findings.push({
        status: "FAIL",
        title: `Semgrep: ${errorsHigh.length} high-severity finding(s)`,
        detail: errorsHigh.slice(0, 15).map((r) => `${r.path}:${r.start.line} ${r.check_id}`).join("\n"),
      });
    }
    if (warns.length) {
      findings.push({
        status: "WARN",
        title: `Semgrep: ${warns.length} warning(s)`,
        detail: warns.slice(0, 15).map((r) => `${r.path}:${r.start.line} ${r.check_id}`).join("\n"),
      });
    }
    if (!findings.length) findings.push({ status: "PASS", title: "Semgrep: no OWASP/Next.js/TS findings" });
  } catch {
    findings = [{ status: "WARN", title: "Semgrep output unparseable", detail: res.stderr.slice(-800) }];
  }

  return { name: "sast", status: worst(findings), findings, durationMs: Date.now() - start };
};
