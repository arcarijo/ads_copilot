// Shared result types for the harness.

export type Status = "PASS" | "FAIL" | "WARN" | "SKIP";

/** One assertion within a check (e.g. "member gets 404 on another tenant's client"). */
export interface Finding {
  status: Status;
  title: string;
  detail?: string;
}

/** The result of one check module (static, authz, dast, ...). */
export interface CheckResult {
  name: string;
  status: Status; // worst of its findings
  findings: Finding[];
  durationMs: number;
  error?: string;
}

/** Context passed to every check. */
export interface RunContext {
  tier: 0 | 1 | 2;
  target: string; // base URL, dynamic checks hit this
  bypassSecret?: string; // Vercel protection-bypass, from env, never logged
  adminToken?: string; // Clerk session JWT for a staging admin fixture
  adminUserId?: string; // Clerk user id of the admin fixture
  memberToken?: string; // Clerk session JWT for a staging member fixture
  memberUserId?: string; // Clerk user id of the member fixture
  memberClientId?: string; // a client owned by the member fixture
  otherClientId?: string; // a client the member fixture does NOT own
  repoRoot: string;
}

export type Check = (ctx: RunContext) => Promise<CheckResult>;

export function worst(findings: Finding[]): Status {
  if (findings.some((f) => f.status === "FAIL")) return "FAIL";
  if (findings.some((f) => f.status === "WARN")) return "WARN";
  if (findings.length && findings.every((f) => f.status === "SKIP")) return "SKIP";
  return "PASS";
}
