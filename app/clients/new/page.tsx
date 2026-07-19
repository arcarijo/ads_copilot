"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VerifyCheck } from "@/lib/meta";

const inputCls =
  "w-full rounded-lg border border-[var(--line-standard)] bg-[var(--surface-1)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const labelCls = "mb-1 block text-sm font-medium text-[var(--ink-secondary)]";
const hintCls = "mt-1 text-xs text-[var(--ink-muted)]";

export default function OnboardClient() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [checks, setChecks] = useState<VerifyCheck[] | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [researchStatus, setResearchStatus] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    contactEmail: "",
    website: "",
    socialLinks: "",
    gmbUrl: "",
    metaAdAccountId: "",
    metaPageId: "",
    metaSystemUserName: "",
    metaSystemUserId: "",
    metaAppId: "",
    metaAccessToken: "",
    metaAppToken: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, socialLinks: form.socialLinks.split("\n").map((s) => s.trim()).filter(Boolean) }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.error) return setError(json.error);
    setClientId(json.clientId);
  }

  async function verify() {
    if (!clientId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${clientId}/verify`, { method: "POST" });
    const json = await res.json();
    setBusy(false);
    setChecks(json.checks ?? []);
    setReady(json.ready ?? false);
  }

  async function buildProfile() {
    if (!clientId) return;
    setBusy(true);
    setResearchStatus("Researching the client's web presence…");
    const res = await fetch(`/api/clients/${clientId}/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "onboarding" }),
    });
    const json = await res.json();
    setBusy(false);
    setResearchStatus(json.status === "DONE" ? `✅ ${json.summary}` : `⚠️ ${json.status}: ${json.summary ?? ""}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Onboard a Client</h1>

      <div className="rounded-xl border border-[var(--line-standard)] bg-[var(--info-wash)] p-4 text-sm text-[var(--ink-secondary)]">
        <p className="mb-2 font-medium text-[var(--info)]">What you need before starting (gather in Meta Business Manager):</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Ad Account ID</b> — Business Settings → Accounts → Ad Accounts (numeric, without &quot;act_&quot;)</li>
          <li><b>Facebook Page ID</b> — the page the ads publish from (Page → About → Page ID)</li>
          <li><b>System User + token</b> — Business Settings → Users → System Users. Create one, assign it the ad account (Manage) and the Page, then generate a token with <code>ads_management</code>, <code>ads_read</code>, <code>pages_read_engagement</code></li>
          <li><b>App ID</b> — the Meta developer app the token was minted through</li>
          <li>Optional but recommended: website, socials, Google Business link — these feed the AI strategy profile</li>
        </ul>
      </div>

      {error && <div className="rounded-xl border border-[var(--line-standard)] bg-[var(--danger-wash)] p-4 text-sm text-[var(--danger)]">{error}</div>}

      {!clientId && (
        <div className="space-y-4 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-6">
          <h2 className="font-medium text-[var(--ink-primary)]">1. Business details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Business name *</label><input className={inputCls} value={form.name} onChange={set("name")} /></div>
            <div><label className={labelCls}>Contact email</label><input className={inputCls} value={form.contactEmail} onChange={set("contactEmail")} placeholder="owner@business.com" /></div>
            <div><label className={labelCls}>Website</label><input className={inputCls} value={form.website} onChange={set("website")} placeholder="https://…" /></div>
            <div><label className={labelCls}>Google Business link</label><input className={inputCls} value={form.gmbUrl} onChange={set("gmbUrl")} placeholder="https://maps.app.goo.gl/…" /></div>
          </div>
          <div>
            <label className={labelCls}>Social media links (one per line)</label>
            <textarea className={inputCls} rows={2} value={form.socialLinks} onChange={set("socialLinks")} placeholder={"https://instagram.com/…\nhttps://facebook.com/…"} />
            <p className={hintCls}>Website + socials are scraped once (max 5 pages) to build the AI strategy profile.</p>
          </div>

          <h2 className="pt-2 font-medium text-[var(--ink-primary)]">2. Meta credentials</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Ad Account ID *</label><input className={inputCls} value={form.metaAdAccountId} onChange={set("metaAdAccountId")} placeholder="1401342273924248" /></div>
            <div><label className={labelCls}>Page ID *</label><input className={inputCls} value={form.metaPageId} onChange={set("metaPageId")} placeholder="139654229230580" /></div>
            <div><label className={labelCls}>System User name</label><input className={inputCls} value={form.metaSystemUserName} onChange={set("metaSystemUserName")} placeholder="Ad_Manager_Bot" /></div>
            <div><label className={labelCls}>System User ID</label><input className={inputCls} value={form.metaSystemUserId} onChange={set("metaSystemUserId")} /></div>
            <div><label className={labelCls}>App ID</label><input className={inputCls} value={form.metaAppId} onChange={set("metaAppId")} /></div>
            <div />
          </div>
          <div>
            <label className={labelCls}>System User access token *</label>
            <textarea className={inputCls} rows={2} value={form.metaAccessToken} onChange={set("metaAccessToken")} />
            <p className={hintCls}>This is the token used to create and manage ads. Stored server-side, never shown again.</p>
          </div>
          <div>
            <label className={labelCls}>App access token (optional)</label>
            <textarea className={inputCls} rows={2} value={form.metaAppToken} onChange={set("metaAppToken")} />
          </div>
          <button onClick={save} disabled={busy || !form.name || !form.metaAdAccountId || !form.metaPageId || !form.metaAccessToken}
            className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50">
            {busy ? "Saving…" : "Save client →"}
          </button>
        </div>
      )}

      {clientId && (
        <div className="space-y-5 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-6">
          <h2 className="font-medium text-[var(--ink-primary)]">3. Verify credentials (read-only check)</h2>
          <button onClick={verify} disabled={busy} className="rounded-lg bg-[var(--info)] px-5 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50">
            {busy && !researchStatus ? "Checking with Meta…" : "Run readiness check"}
          </button>
          {checks && (
            <div className="space-y-2">
              {checks.map((c) => (
                <div key={c.item} className="flex gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">
                  <span>{c.ok ? "✅" : "❌"}</span>
                  <div><span className="font-medium">{c.item}:</span> <span className="text-[var(--ink-secondary)]">{c.detail}</span></div>
                </div>
              ))}
              <p className={`text-sm font-semibold ${ready ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                {ready ? "✅ Ready to launch ads for this client." : "❌ Not ready — fix the failed items above and re-run."}
              </p>
            </div>
          )}

          <h2 className="pt-2 font-medium text-[var(--ink-primary)]">4. Build AI strategy profile</h2>
          <button onClick={buildProfile} disabled={busy} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50">
            {busy && researchStatus ? "Researching…" : "Scrape web presence & build profile"}
          </button>
          {researchStatus && <p className="text-sm text-[var(--ink-secondary)]">{researchStatus}</p>}

          <div className="pt-2">
            <button onClick={() => router.push(`/clients/${clientId}`)} className="text-sm text-[var(--success)] hover:underline">
              Done → view client page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
