// Tier 1: secret scanning with gitleaks (containerized). Scans the working
// tree AND git history for committed credentials — the exact risk when many
// env-touching changes are in flight.

import { exec, dockerMount } from "../lib/exec";
import { DOCKER_IMAGES } from "../config";
import type { Check, Finding } from "../types";
import { worst } from "../types";

export const secretsCheck: Check = async (ctx) => {
  const start = Date.now();
  const mount = dockerMount(ctx.repoRoot);

  // gitleaks exits non-zero when leaks are found; --no-banner keeps output clean.
  const res = await exec(
    "docker",
    ["run", "--rm", "-v", `${mount}:/repo`, DOCKER_IMAGES.gitleaks, "detect", "--source=/repo", "--no-banner", "--report-format=json", "--report-path=/repo/.redteam-gitleaks.json"],
    { cwd: ctx.repoRoot, timeoutMs: 180_000 },
  );

  let findings: Finding[];
  if (res.code === 0) {
    findings = [{ status: "PASS", title: "gitleaks: no secrets in tree or history" }];
  } else if (res.code === 1) {
    findings = [
      {
        status: "FAIL",
        title: "gitleaks: potential secret(s) detected",
        detail: "See .redteam-gitleaks.json (gitignored) for locations. Rotate anything real and purge from history.",
      },
    ];
  } else {
    findings = [{ status: "WARN", title: "gitleaks failed to run", detail: res.stderr.slice(-500) }];
  }

  return { name: "secrets", status: worst(findings), findings, durationMs: Date.now() - start };
};
