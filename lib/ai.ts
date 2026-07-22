import { prisma } from "./db";

// Small, fast, cheap edge model — fine for short/constrained generations.
export const EDGE_MODEL = "@cf/meta/llama-3.2-3b-instruct";
// Larger model for quality-critical, low-frequency synthesis (research, plan,
// client-facing report). The 3B model loops/degenerates on long structured
// output; this one is reliable and still comfortably within the free tier at
// these volumes. fp8-fast keeps latency and neuron cost down.
export const SMART_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_MODEL = EDGE_MODEL;

interface CfAiResponse {
  result?: {
    response?: string | null;
    choices?: { message?: { content?: string | null } }[];
  };
  success?: boolean;
  errors?: { message: string }[];
}

/**
 * Thrown when the AI backend is unconfigured or unreachable (missing creds,
 * Cloudflare error/outage). Its message carries the real reason for SERVER logs;
 * user-facing callers must catch this and show a friendly, non-leaky message
 * instead of surfacing internal env-var names.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/**
 * Runs the Cloudflare Workers AI Llama model with a system + user prompt and
 * returns strictly parsed JSON. Prompts demand JSON-only output; this parser
 * still defensively strips markdown fences and extracts the outermost object.
 */
export async function runLlamaJson<T>(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; temperature?: number; model?: string; kind?: "RESEARCH" | "COPILOT" | "OPTIMIZER" } = {}
): Promise<T> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AUTH_TOKEN;
  if (!accountId || !token) {
    throw new AiUnavailableError("Cloudflare credentials missing: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_TOKEN.");
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as CfAiResponse;
  if (!res.ok || json.success === false) {
    const msg = json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new AiUnavailableError(`Cloudflare Workers AI request failed: ${msg}`);
  }

  // A successful call consumed Cloudflare quota regardless of what happens
  // during JSON parsing below — record it now for the capacity monitor.
  // Fire-and-forget: never let usage tracking block or fail the AI call.
  prisma.usageEvent.create({ data: { kind: opts.kind ?? "OPTIMIZER", model } }).catch(() => {});

  // The v2 model returns content in choices[].message.content; the top-level
  // `response` field is often null. Prefer whichever is a non-empty string.
  const r = json.result ?? {};
  const text =
    (typeof r.response === "string" && r.response.trim() ? r.response : undefined) ??
    (typeof r.choices?.[0]?.message?.content === "string" ? r.choices[0].message!.content! : "") ??
    "";
  return extractJson<T>(text);
}

export function extractJson<T>(input: unknown): T {
  if (input && typeof input === "object") return input as T; // already parsed
  const text = typeof input === "string" ? input : String(input ?? "");
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw new Error(`AI returned non-JSON output: ${cleaned.slice(0, 200)}`);
  }

  const body = cleaned.slice(start);
  const end = body.lastIndexOf("}");
  if (end > 0) {
    try {
      return JSON.parse(body.slice(0, end + 1)) as T;
    } catch {
      // fall through to repair
    }
  }
  // Repair truncated output (model hit the token ceiling mid-JSON): close any
  // open string and balance braces/brackets, then parse the salvaged object.
  const repaired = repairTruncatedJson(body);
  try {
    return JSON.parse(repaired) as T;
  } catch {
    throw new Error(`AI returned non-JSON output: ${cleaned.slice(0, 200)}`);
  }
}

function repairTruncatedJson(s: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s.trimEnd();
  if (inString) {
    // Truncated inside a string value: close the string.
    out += '"';
  } else {
    // Drop a dangling comma or a key with no value ("foo": ) before closing.
    out = out.replace(/,\s*$/, "").replace(/"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
  }
  while (stack.length) out += stack.pop();
  return out;
}
