// Thin wrapper over child_process. Spawns without a shell (args array) so
// Windows paths passed to `docker -v` aren't mangled by Git Bash.

import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; shell?: boolean } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // Windows can't spawn .cmd launchers (npm/npx) without a shell; docker.exe is
    // fine shell-free (and we keep it that way so volume paths aren't mangled).
    const shell = opts.shell ?? false;
    const child = spawn(cmd, args, { cwd: opts.cwd, shell });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          stderr += `\n[timeout after ${opts.timeoutMs}ms]`;
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + `\n${e.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

/** Repo root as a Docker-friendly volume path (forward slashes). */
export function dockerMount(repoRoot: string): string {
  return repoRoot.replace(/\\/g, "/");
}
