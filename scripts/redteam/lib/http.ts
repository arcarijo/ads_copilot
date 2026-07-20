// HTTP helpers for the dynamic checks. Every request to the preview target
// carries the Vercel protection-bypass header so it gets past Deployment
// Protection; the secret itself is never logged.

export interface Req {
  method?: string;
  path: string;
  token?: string; // Clerk session JWT -> Authorization: Bearer
  body?: unknown;
  bypassSecret?: string;
}

export interface Res {
  status: number;
  json: unknown;
  text: string;
}

export async function call(base: string, req: Req): Promise<Res> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.token) headers["Authorization"] = `Bearer ${req.token}`;
  if (req.bypassSecret) headers["x-vercel-protection-bypass"] = req.bypassSecret;

  const res = await fetch(new URL(req.path, base), {
    method: req.method ?? "GET",
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    redirect: "manual",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response (e.g. an HTML page) — keep text only */
  }
  return { status: res.status, json, text };
}
