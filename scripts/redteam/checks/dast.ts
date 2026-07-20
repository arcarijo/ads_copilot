// Tier 2: dynamic scanning of the running preview app. OWASP ZAP (passive
// baseline + active attack scan) and Nuclei (template scanner). Both inject the
// Vercel protection-bypass header so they clear Deployment Protection. The
// active ZAP scan sends real attack payloads — it only ever runs against the
// preview/staging target the guard has already approved.

import { exec, dockerMount } from "../lib/exec";
import { DOCKER_IMAGES } from "../config";
import type { Check, Finding } from "../types";
import { worst } from "../types";

const BYPASS_HEADER = "x-vercel-protection-bypass";

/** ZAP replacer options that add the bypass header to every outgoing request. */
function zapHeaderOpts(secret: string): string {
  return [
    "replacer.full_list(0).description=bypass",
    "replacer.full_list(0).enabled=true",
    "replacer.full_list(0).matchtype=REQ_HEADER",
    `replacer.full_list(0).matchstr=${BYPASS_HEADER}`,
    `replacer.full_list(0).regex=false`,
    `replacer.full_list(0).replacement=${secret}`,
  ].join(" ");
}

function classifyZap(code: number, label: string): Finding {
  // zap-baseline/full: 0 = clean, 1 = FAIL present, 2 = WARN present, else error
  if (code === 0) return { status: "PASS", title: `ZAP ${label}: no alerts above threshold` };
  if (code === 1) return { status: "FAIL", title: `ZAP ${label}: FAIL-level alert(s) — see report HTML` };
  if (code === 2) return { status: "WARN", title: `ZAP ${label}: WARN-level alert(s) — see report HTML` };
  return { status: "WARN", title: `ZAP ${label}: scanner error (exit ${code})` };
}

export const dastCheck: Check = async (ctx) => {
  const start = Date.now();
  const findings: Finding[] = [];
  const wrk = dockerMount(`${ctx.repoRoot}/scripts/redteam/report`);
  const secret = ctx.bypassSecret;

  if (!secret) {
    return {
      name: "dast",
      status: "SKIP",
      findings: [{ status: "SKIP", title: "dast skipped — VERCEL_AUTOMATION_BYPASS_SECRET not set" }],
      durationMs: Date.now() - start,
    };
  }

  const zapCommon = ["run", "--rm", "-v", `${wrk}:/zap/wrk:rw`, DOCKER_IMAGES.zap];
  const zTimeout = Number(process.env.REDTEAM_ZAP_TIMEOUT_MS ?? 900_000);

  // Passive baseline — always safe.
  const baseline = await exec(
    "docker",
    [...zapCommon, "zap-baseline.py", "-t", ctx.target, "-I", "-r", "zap-baseline.html", "-z", zapHeaderOpts(secret)],
    { cwd: ctx.repoRoot, timeoutMs: zTimeout },
  );
  findings.push(classifyZap(baseline.code, "baseline (passive)"));

  // Active attack scan — the aggressive part. On by default at T2; disable with REDTEAM_ZAP_FULL=0.
  if (process.env.REDTEAM_ZAP_FULL !== "0") {
    const full = await exec(
      "docker",
      [...zapCommon, "zap-full-scan.py", "-t", ctx.target, "-I", "-r", "zap-full.html", "-z", zapHeaderOpts(secret)],
      { cwd: ctx.repoRoot, timeoutMs: zTimeout },
    );
    findings.push(classifyZap(full.code, "full (active)"));
  } else {
    findings.push({ status: "SKIP", title: "ZAP full active scan skipped (REDTEAM_ZAP_FULL=0)" });
  }

  // Nuclei template scan.
  const nuclei = await exec(
    "docker",
    [
      "run", "--rm", DOCKER_IMAGES.nuclei,
      "-u", ctx.target, "-H", `${BYPASS_HEADER}: ${secret}`,
      "-severity", "medium,high,critical", "-jsonl", "-silent", "-nc",
    ],
    { cwd: ctx.repoRoot, timeoutMs: 600_000 },
  );
  const hits = nuclei.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  findings.push(
    hits.length === 0
      ? { status: "PASS", title: "Nuclei: no medium+ template matches" }
      : {
          status: "FAIL",
          title: `Nuclei: ${hits.length} template match(es)`,
          detail: hits.slice(0, 15).join("\n").slice(0, 2000),
        },
  );

  return { name: "dast", status: worst(findings), findings, durationMs: Date.now() - start };
};
