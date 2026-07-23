// Loads a .env-style file and runs a command with it, so one-off CLI
// commands (prisma migrate resolve/deploy, etc.) can reach secrets that live
// outside the auto-loaded .env/.env.local — e.g. .env.production.secrets —
// without exporting them into the shell by hand first.
//
//   npm run prisma:prod -- migrate resolve --applied <name>
//   npm run prisma:prod -- migrate deploy
//
// Values from --file always override any same-named var already in the
// shell, since the point is guaranteeing the file's value wins.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) {
    console.error(`with-env: ${path} not found.`);
    process.exit(1);
  }
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
    process.env[key] = val;
  }
}

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith("--file="));
const sepIndex = args.indexOf("--");

if (!fileArg || sepIndex === -1 || sepIndex === args.length - 1) {
  console.error("Usage: tsx scripts/with-env.ts --file=<path> -- <command> [args...]");
  process.exit(1);
}

loadEnvFile(resolve(process.cwd(), fileArg.slice("--file=".length)));

const [cmd, ...cmdArgs] = args.slice(sepIndex + 1);
const result = spawnSync(cmd, cmdArgs, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
