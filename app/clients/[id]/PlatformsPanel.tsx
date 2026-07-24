"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { VerifyCheck } from "@/lib/meta";
import { getCheckResolution } from "@/lib/preflightResolutions";
import { PLATFORMS, PlatformSpec } from "@/lib/platforms";
import { Icon, IconName } from "./../../components/Icon";

const PLATFORM_ICON: Record<string, IconName> = {
  META: "megaphone",
  GOOGLE: "search",
  TIKTOK: "music",
  PINTEREST: "pin",
  LINKEDIN: "briefcase",
};

const inputCls =
  "w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm outline-none transition-colors focus:ring-1";
const inputStyle = { background: "var(--surface-inset)", border: "1px solid var(--line-standard)", color: "var(--ink-primary)" };

export interface PlatformRow {
  platform: string;
  enabled: boolean;
  status: string;
  directive: string;
  directiveAt: string | null;
}

export function PlatformsPanel({
  clientId,
  isAdmin,
  platforms,
  clientStatus,
  verify,
}: {
  clientId: string;
  isAdmin: boolean;
  platforms: PlatformRow[];
  clientStatus: string;
  verify: { ready: boolean; checks: VerifyCheck[] } | null;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [credDraft, setCredDraft] = useState<Record<string, string>>({});
  const [savedCreds, setSavedCreds] = useState<Record<string, Record<string, string>>>({});
  const [directiveDraft, setDirectiveDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  // Meta credential readiness (folded in from its own section).
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<VerifyCheck[] | null>(verify?.checks ?? null);
  const [ready, setReady] = useState<boolean | null>(verify?.ready ?? null);
  const [notifying, setNotifying] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState<string | null>(null);

  const rowFor = (key: string) => platforms.find((p) => p.platform === key);

  async function runReadiness() {
    setChecking(true);
    setNotifyStatus(null);
    const res = await fetch(`/api/clients/${clientId}/verify`, { method: "POST" });
    const json = await res.json();
    setChecking(false);
    setChecks(json.checks ?? []);
    setReady(json.ready ?? false);
    router.refresh();
  }

  // Silent background re-check whenever someone opens this client's page, so
  // readiness reflects reality now rather than whatever the last manual click
  // or the nightly cron sweep last recorded. Doesn't touch the `checking`
  // spinner or router.refresh() — those are for the explicit button only.
  // Throttled client-side (sessionStorage) so repeated navigation/refresh
  // can't be used to hammer the tenant's own Meta API quota.
  useEffect(() => {
    const key = `readiness-check:${clientId}`;
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 5 * 60 * 1000) return;
    sessionStorage.setItem(key, String(Date.now()));

    let cancelled = false;
    fetch(`/api/clients/${clientId}/verify`, { method: "POST" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setChecks(json.checks ?? []);
        setReady(json.ready ?? false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function notifyAdmin() {
    setNotifying(true);
    const res = await fetch(`/api/clients/${clientId}/notify`, { method: "POST" });
    const json = await res.json();
    setNotifying(false);
    setNotifyStatus(json.sent ? "Sent — the admin has been emailed with these details." : json.reason ?? json.error ?? "Could not send.");
  }

  async function toggle(spec: PlatformSpec, enabled: boolean) {
    setBusyKey(spec.key);
    await fetch(`/api/clients/${clientId}/platforms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: spec.key, enabled }),
    });
    setBusyKey(null);
    if (enabled && spec.key !== "META") setOpenKey(spec.key);
    router.refresh();
  }

  async function openSetup(spec: PlatformSpec) {
    const next = openKey === spec.key ? null : spec.key;
    setOpenKey(next);
    setMsg(null);
    const row = rowFor(spec.key);
    setDirectiveDraft((d) => ({ ...d, [spec.key]: d[spec.key] ?? row?.directive ?? "" }));
    if (next && isAdmin && spec.key !== "META" && !savedCreds[spec.key]) {
      const res = await fetch(`/api/clients/${clientId}/platforms`);
      const json = await res.json().catch(() => ({ connections: [] }));
      const conn = (json.connections ?? []).find((c: { platform: string }) => c.platform === spec.key);
      setSavedCreds((s) => ({ ...s, [spec.key]: conn?.creds ?? {} }));
    }
  }

  async function saveCreds(spec: PlatformSpec) {
    setBusyKey(spec.key);
    const creds: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = credDraft[`${spec.key}.${f.key}`];
      if (v?.trim()) creds[f.key] = v.trim();
    }
    const res = await fetch(`/api/clients/${clientId}/platforms/${spec.key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creds }),
    });
    setBusyKey(null);
    setMsg(res.ok ? "✅ Saved — status updates once every required field is in." : "⚠️ Save failed.");
    setSavedCreds((s) => ({ ...s, [spec.key]: {} })); // force refetch next open
    router.refresh();
  }

  async function saveDirective(spec: PlatformSpec) {
    setBusyKey(spec.key);
    await fetch(`/api/clients/${clientId}/platforms/${spec.key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directive: directiveDraft[spec.key] ?? "" }),
    });
    setBusyKey(null);
    router.refresh();
  }

  const statusTone = clientStatus === "VERIFIED" ? "var(--success)" : clientStatus === "ERROR" ? "var(--danger)" : "var(--warning)";

  return (
    <section className="rounded-[var(--radius-lg)] p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
      <h2 className="font-display font-medium" style={{ color: "var(--ink-primary)" }}>Ad Platforms</h2>
      <p className="mb-4 mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
        Pick where your ads run — each platform owns a different moment of your customers&apos; lives. Toggle one on and{" "}
        {isAdmin ? "complete its connection below" : "your admin will wire up the connection"}; you can add platforms any time as your marketing grows.
      </p>

      <div className="space-y-3">
        {PLATFORMS.map((spec) => {
          const row = rowFor(spec.key);
          const isMeta = spec.key === "META";
          const enabled = isMeta ? true : (row?.enabled ?? false);
          const status = isMeta ? clientStatus : (row?.status ?? "PENDING");
          const isOpen = openKey === spec.key;
          const saved = savedCreds[spec.key] ?? {};
          const metaConnected = status === "VERIFIED";
          return (
            <div key={spec.key} className="overflow-hidden rounded-[var(--radius-md)]" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] transition-transform duration-200"
                    style={{ background: enabled ? "var(--accent-wash)" : "var(--surface-3)", color: enabled ? "var(--accent)" : "var(--ink-tertiary)" }}
                  >
                    <Icon name={PLATFORM_ICON[spec.key] ?? "megaphone"} size="1.35rem" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{spec.label}</h3>
                      {enabled && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={
                            isMeta
                              ? { background: metaConnected ? "var(--success-wash)" : "var(--warning-wash)", color: metaConnected ? "var(--success)" : "var(--warning)" }
                              : status === "CONNECTED"
                                ? { background: "var(--success-wash)", color: "var(--success)" }
                                : { background: "var(--warning-wash)", color: "var(--warning)" }
                          }
                        >
                          {isMeta ? (metaConnected ? "Ready" : clientStatus === "ERROR" ? "Check failed" : "Not checked") : status === "CONNECTED" ? "Connected" : "Needs connection"}
                        </span>
                      )}
                      {!spec.executes && enabled && (
                        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-3)", color: "var(--ink-tertiary)" }}>
                          launches soon — connect now
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 max-w-xl text-xs" style={{ color: "var(--ink-secondary)" }}>{spec.tagline}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(isMeta || enabled) && (
                    <button
                      onClick={() => openSetup(spec)}
                      className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors hover:brightness-110"
                      style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
                    >
                      {isOpen ? "Close" : isMeta ? "Readiness" : status === "CONNECTED" ? "Manage" : "Set up"}
                    </button>
                  )}
                  {isMeta ? (
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>always on</span>
                  ) : (
                    <button
                      onClick={() => toggle(spec, !enabled)}
                      disabled={busyKey === spec.key}
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? "Disable" : "Enable"} ${spec.label}`}
                      className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50"
                      style={{ background: enabled ? "var(--accent)" : "var(--surface-3)" }}
                    >
                      <span
                        className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                        style={{ transform: enabled ? "translateX(20px)" : "translateX(0)" }}
                        aria-hidden
                      />
                    </button>
                  )}
                </div>
              </div>

              {/* Meta: readiness check folded in here */}
              {isOpen && isMeta && (
                <div className="space-y-4 border-t p-4" style={{ borderColor: "var(--line-subtle)" }}>
                  <ul className="space-y-1">
                    {spec.coaching.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                        <Icon name="sparkle" size="0.85rem" style={{ color: "var(--accent)", marginTop: "0.15rem" }} /> <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-[var(--radius-sm)] p-3" style={{ background: "var(--surface-inset)", border: "1px solid var(--line-subtle)" }}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>Credential readiness</h4>
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                          Status <span style={{ color: statusTone }}>{clientStatus}</span> — checks your token, ad account, funding, Page, Instagram, and ad-creation permission on Meta.
                        </p>
                      </div>
                      <button
                        onClick={runReadiness}
                        disabled={checking}
                        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
                        style={{ background: "var(--accent)" }}
                      >
                        {checking ? "Checking with Meta…" : checks ? "Re-run check" : "Run readiness check"}
                      </button>
                    </div>
                    {checks && (
                      <div className="space-y-1.5 text-xs">
                        {checks.map((c) => {
                          const resolution = !c.ok ? getCheckResolution(`Meta: ${c.item}`) : undefined;
                          return (
                            <div key={c.item} className="flex items-start gap-2">
                              <Icon name={c.ok ? "check" : "x"} size="0.95rem" strokeWidth={2.25} style={{ color: c.ok ? "var(--success)" : "var(--danger)", marginTop: "0.1rem" }} />
                              <div style={{ color: "var(--ink-secondary)" }}>
                                <b style={{ color: "var(--ink-primary)" }}>{c.item}</b> — {c.detail}
                                {resolution && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[11px] font-medium" style={{ color: "var(--accent)" }}>How to fix this</summary>
                                    <div className="mt-1 space-y-1.5 text-[11px]" style={{ color: "var(--ink-secondary)" }}>
                                      <p>{resolution.instructions}</p>
                                      {resolution.helpUrl && (
                                        <a
                                          href={resolution.helpUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-block rounded px-2 py-0.5 font-medium hover:brightness-110"
                                          style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
                                        >
                                          Meta support doc ↗
                                        </a>
                                      )}
                                    </div>
                                  </details>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <p className="flex items-center gap-1.5 pt-1 font-semibold" style={{ color: ready ? "var(--success)" : "var(--danger)" }}>
                          <Icon name={ready ? "check" : "x"} size="0.95rem" strokeWidth={2.25} />
                          {ready ? "Ready to launch ads." : "Not ready — fix failed items and re-run."}
                        </p>
                        {ready === false && (
                          <div className="flex items-center gap-3 pt-1">
                            <button
                              onClick={notifyAdmin}
                              disabled={notifying}
                              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors hover:brightness-110 disabled:opacity-50"
                              style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
                            >
                              {notifying ? "Sending…" : "Email admin about this"}
                            </button>
                            {notifyStatus && <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>{notifyStatus}</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Other platforms: connect + steer */}
              {isOpen && enabled && !isMeta && (
                <div className="space-y-4 border-t p-4" style={{ borderColor: "var(--line-subtle)" }}>
                  <ul className="space-y-1">
                    {spec.coaching.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                        <Icon name="sparkle" size="0.85rem" style={{ color: "var(--accent)", marginTop: "0.15rem" }} /> <span>{c}</span>
                      </li>
                    ))}
                  </ul>

                  <div>
                    <label htmlFor={`dir-${spec.key}`} className="mb-1 block text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>
                      {spec.label.split(" ")[0]} directive — what should ads here push right now?
                    </label>
                    <textarea
                      id={`dir-${spec.key}`}
                      className={inputCls}
                      style={inputStyle}
                      rows={2}
                      value={directiveDraft[spec.key] ?? ""}
                      onChange={(e) => setDirectiveDraft((d) => ({ ...d, [spec.key]: e.target.value }))}
                      placeholder={
                        spec.key === "PINTEREST"
                          ? "e.g. Push all-inclusive winter wedding packages; ease off elopements."
                          : spec.key === "LINKEDIN"
                            ? "e.g. Target 20-80 person companies for December holiday parties."
                            : "What should this platform's ads prioritize right now?"
                      }
                    />
                    <button
                      onClick={() => saveDirective(spec)}
                      disabled={busyKey === spec.key}
                      className="mt-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
                      style={{ background: "var(--accent)" }}
                    >
                      Save directive
                    </button>
                  </div>

                  <div className="rounded-[var(--radius-sm)] p-3" style={{ background: "var(--surface-inset)", border: "1px solid var(--line-subtle)" }}>
                    <p className="text-xs" style={{ color: "var(--ink-secondary)" }}>
                      <b style={{ color: "var(--ink-primary)" }}>Connecting:</b> {spec.signIn.note}
                    </p>
                    {spec.gotcha && <p className="mt-2 text-xs" style={{ color: "var(--warning)" }}>⚠ {spec.gotcha}</p>}
                  </div>

                  {isAdmin ? (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>
                        Admin: connection credentials
                      </h4>
                      {spec.envKeys.length > 0 && (
                        <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                          App-level keys go in Vercel env vars, not here: {spec.envKeys.map((e) => e.key).join(", ")}.
                        </p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {spec.fields.map((f) => (
                          <div key={f.key} className={f.help.length > 80 ? "sm:col-span-2" : ""}>
                            <label htmlFor={`${spec.key}-${f.key}`} className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-tertiary)" }}>
                              {f.label} {f.required && <span style={{ color: "var(--danger)" }}>*</span>}
                            </label>
                            <input
                              id={`${spec.key}-${f.key}`}
                              type={f.secret ? "password" : "text"}
                              className={inputCls}
                              style={inputStyle}
                              placeholder={saved[f.key] ? (f.secret ? "•••••••• (saved — paste to replace)" : saved[f.key]) : f.help}
                              value={credDraft[`${spec.key}.${f.key}`] ?? ""}
                              onChange={(e) => setCredDraft((d) => ({ ...d, [`${spec.key}.${f.key}`]: e.target.value }))}
                            />
                            <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>{f.help}</p>
                          </div>
                        ))}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs" style={{ color: "var(--ink-tertiary)" }}>
                          OAuth scopes to request ({spec.scopes.length})
                        </summary>
                        <ul className="mt-1 space-y-1 pl-4">
                          {spec.scopes.map((s) => (
                            <li key={s.scope} className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                              <code style={{ color: "var(--ink-secondary)" }}>{s.scope}</code> — {s.why}
                            </li>
                          ))}
                        </ul>
                      </details>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => saveCreds(spec)}
                          disabled={busyKey === spec.key}
                          className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
                          style={{ background: "var(--accent)" }}
                        >
                          {busyKey === spec.key ? "Saving…" : "Save credentials"}
                        </button>
                        {msg && <span className="text-xs" style={{ color: "var(--ink-secondary)" }}>{msg}</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--ink-tertiary)" }}>
                      {status === "CONNECTED"
                        ? "✅ This platform is connected and ready."
                        : "Your admin is setting up this connection — you'll see \"Connected\" here once it's live. Your directive above is already saved and waiting."}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
