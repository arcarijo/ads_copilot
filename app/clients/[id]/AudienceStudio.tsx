"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AUDIENCE_KINDS } from "@/lib/audienceKinds";
import { Icon, IconName } from "../../components/Icon";

const KIND_ICON: Record<string, IconName> = {
  CUSTOMER_LIST: "contacts",
  ENGAGEMENT: "heart",
  LOOKALIKE: "users",
  BLUEPRINT: "dna",
};

const inputCls =
  "w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm outline-none transition-colors focus:ring-1";
const inputStyle = { background: "var(--surface-inset)", border: "1px solid var(--line-standard)", color: "var(--ink-primary)" };

export interface AudienceRow {
  id: string;
  kind: string;
  name: string;
  metaAudienceId: string | null;
  sourceNote: string;
  createdAt: string;
}

interface RemoteAudience {
  id: string;
  name: string;
  subtype?: string;
  approximate_count_lower_bound?: number;
  time_updated?: string;
}

// CSV template the owner can download, fill in their booking system export,
// and re-upload. Extra columns are fine — we only read email/phone.
const CSV_TEMPLATE = "email,phone,name\njane@example.com,4165551234,Jane Doe\n,6475559876,Phone-only contact\nsam@example.com,,Email-only contact\n";
const CSV_TEMPLATE_URI = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

/** Minimal CSV parse (handles quoted fields) → array of rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (cell || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Interpret headers to find email/phone columns; fall back to value patterns. */
function extractContactsFromCsv(text: string): { contacts: string[]; emails: number; phones: number; note: string } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { contacts: [], emails: 0, phones: 0, note: "The file looks empty." };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const emailCol = headers.findIndex((h) => /e-?mail/.test(h));
  const phoneCol = headers.findIndex((h) => /phone|mobile|cell|tel/.test(h));
  const hasHeader = emailCol >= 0 || phoneCol >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const contacts: string[] = [];
  let emails = 0;
  let phones = 0;
  for (const r of dataRows) {
    const cells = hasHeader
      ? [emailCol >= 0 ? r[emailCol] : "", phoneCol >= 0 ? r[phoneCol] : ""]
      : r; // no recognizable header: scan every cell by pattern
    for (const c of cells) {
      const v = (c ?? "").trim();
      if (!v) continue;
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { contacts.push(v); emails++; }
      else if (v.replace(/[^\d]/g, "").length >= 10) { contacts.push(v); phones++; }
    }
  }
  const note = hasHeader
    ? `Read columns "${emailCol >= 0 ? rows[0][emailCol] : "—"}" and "${phoneCol >= 0 ? rows[0][phoneCol] : "—"}" from your headers.`
    : "No email/phone headers found — scanned every cell for email and phone patterns instead.";
  return { contacts, emails, phones, note };
}

export function AudienceStudio({ clientId, audiences }: { clientId: string; audiences: AudienceRow[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [updateTargetId, setUpdateTargetId] = useState("");
  const [remote, setRemote] = useState<RemoteAudience[] | null>(null);
  const [remoteMsg, setRemoteMsg] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ name: string; metaAudienceId: string | null; summary: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  const metaBacked = audiences.filter((a) => a.metaAudienceId);
  const customerLists = metaBacked.filter((a) => a.kind === "CUSTOMER_LIST");

  async function loadRemote() {
    setRemoteBusy(true);
    setRemoteMsg(null);
    const res = await fetch(`/api/clients/${clientId}/audiences/remote`);
    const json = await res.json().catch(() => ({}));
    setRemoteBusy(false);
    if (!res.ok) {
      setRemote([]);
      setRemoteMsg(`Couldn't read your Meta account: ${json.error ?? "unknown error"}`);
      return;
    }
    setRemote(json.remote ?? []);
    setRemoteMsg((json.remote ?? []).length === 0 ? "Your Meta ad account has no audiences yet — everything you build below will appear here." : null);
  }

  function onCsvPicked(kind: string, file: File) {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { contacts, emails, phones, note } = extractContactsFromCsv(String(reader.result ?? ""));
      if (contacts.length === 0) {
        setCsvNote(`No emails or phone numbers found in "${file.name}". ${note} Download the template below to see the expected format.`);
        return;
      }
      setDraft((d) => ({ ...d, [`${kind}.contacts`]: contacts.join("\n") }));
      setCsvNote(`Loaded ${contacts.length} contacts from "${file.name}" (${emails} emails, ${phones} phone numbers). ${note}`);
    };
    reader.readAsText(file);
  }

  async function create(kind: string) {
    setBusy(true);
    setMsg(null);
    setLastCreated(null);
    const input: Record<string, string> = {};
    const spec = AUDIENCE_KINDS.find((k) => k.kind === kind);
    for (const f of spec?.fields ?? []) input[f.key] = draft[`${kind}.${f.key}`] ?? "";
    if (kind === "CUSTOMER_LIST" && updateTargetId) {
      input.existingAudienceLocalId = updateTargetId;
      input.name = input.name || customerLists.find((a) => a.id === updateTargetId)?.name || "update";
    }
    const res = await fetch(`/api/clients/${clientId}/audiences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, input }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(json.error ?? "Could not create the audience.");
      return;
    }
    setLastCreated({ name: input.name, metaAudienceId: json.metaAudienceId ?? null, summary: json.summary ?? "Done." });
    setDraft({});
    setCsvNote(null);
    setUpdateTargetId("");
    setOpenKind(null);
    if (json.metaAudienceId) loadRemote(); // refresh the live view so they SEE it land
    router.refresh();
  }

  return (
    <section className="rounded-[var(--radius-lg)] p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
      <h2 className="font-display font-medium" style={{ color: "var(--ink-primary)" }}>Audience Studio</h2>
      <p className="mb-4 mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
        Turn what you know about your customers into persistent Meta audiences. Everything you build here lives in your ad
        account and the campaign Copilot uses it automatically — warm retargeting + cold prospecting, the way real promoters structure spend.
      </p>

      {/* What's actually on Meta right now — reality, not just our records */}
      <div className="mb-4 rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>
              <Icon name="broadcast" size="1rem" style={{ color: "var(--accent)" }} /> On your Meta account right now
            </h3>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Live from Meta — includes audiences made outside this app. Sizes update as Meta matches people.
            </p>
          </div>
          <button
            onClick={loadRemote}
            disabled={remoteBusy}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
          >
            {remoteBusy ? "Checking Meta…" : remote === null ? "Check what's there" : "Refresh"}
          </button>
        </div>
        {remoteMsg && <p className="mt-2 text-xs" style={{ color: "var(--ink-secondary)" }}>{remoteMsg}</p>}
        {remote !== null && remote.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {remote.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs" style={{ background: "var(--surface-inset)" }}>
                <span className="font-semibold" style={{ color: "var(--ink-primary)" }}>{r.name}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-3)", color: "var(--ink-tertiary)" }}>
                  {(r.subtype ?? "CUSTOM").toLowerCase()}
                </span>
                <span className="tabular-nums" style={{ color: "var(--ink-muted)" }}>
                  {r.approximate_count_lower_bound ? `~${r.approximate_count_lower_bound.toLocaleString()} people` : "size pending"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && <p className="mb-3 text-sm" style={{ color: "var(--ink-secondary)" }}>{msg}</p>}

      {/* Post-creation receipt: exactly what was made and where it lives */}
      {lastCreated && (
        <div className="pop-in mb-4 rounded-[var(--radius-md)] p-4" style={{ background: "var(--success-wash)", border: "1px solid rgba(74,222,128,0.3)" }}>
          <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>
            <Icon name="check" size="0.95rem" strokeWidth={2.25} style={{ color: "var(--success)" }} /> {lastCreated.name}
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{lastCreated.summary}</p>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-tertiary)" }}>
            {lastCreated.metaAudienceId
              ? `It now lives in your Meta ad account (Ads Manager → Audiences, ID ${lastCreated.metaAudienceId}) and in the list above. The campaign Copilot can use it in every new campaign.`
              : "Saved as a blueprint in this platform — the campaign Copilot applies it automatically when planning your next campaign. Nothing was created on Meta."}
          </p>
        </div>
      )}

      {/* Builder cards — one per owner-knowledge question */}
      <div className="grid gap-3 sm:grid-cols-2">
        {AUDIENCE_KINDS.map((spec) => {
          const isOpen = openKind === spec.kind;
          const lookalikeBlocked = spec.kind === "LOOKALIKE" && metaBacked.length === 0;
          return (
            <article key={spec.kind} className="flex flex-col rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
                  <Icon name={KIND_ICON[spec.kind] ?? "target"} size="1.05rem" />
                </span>
                <h3 className="text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{spec.title}</h3>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{spec.knowledgePrompt}</p>
              <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                <Icon name="sparkle" size="0.8rem" style={{ color: "var(--accent)", marginTop: "0.1rem" }} /> <span>{spec.coaching}</span>
              </p>

              {isOpen ? (
                <div className="mt-3 space-y-3">
                  {/* CSV tools for the customer list */}
                  {spec.kind === "CUSTOMER_LIST" && (
                    <div className="space-y-2 rounded-[var(--radius-sm)] p-3" style={{ background: "var(--surface-inset)", border: "1px solid var(--line-subtle)" }}>
                      <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                        <b style={{ color: "var(--ink-primary)" }}>Easiest way:</b> export contacts from your booking system as a CSV and upload it here.
                        We read <code>email</code> and <code>phone</code> columns by their headers (extra columns like names are ignored) — or{" "}
                        <a href={CSV_TEMPLATE_URI} download="copilot-contacts-template.csv" className="underline underline-offset-2" style={{ color: "var(--accent)" }}>
                          download the template
                        </a>{" "}
                        and fill it in.
                      </p>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".csv,text/csv"
                        aria-label="Upload contacts CSV"
                        className="sr-only"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsvPicked(spec.kind, f); }}
                      />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onCsvPicked(spec.kind, f); }}
                        className="flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-4 py-6 text-center transition-colors"
                        style={{
                          border: `1.5px dashed ${dragOver ? "var(--accent)" : "var(--line-standard)"}`,
                          background: dragOver ? "var(--accent-wash)" : "transparent",
                        }}
                      >
                        <Icon name={csvFileName ? "file" : "upload"} size="1.75rem" style={{ color: "var(--accent)" }} className={dragOver ? "icon-nudge" : undefined} />
                        {csvFileName ? (
                          <>
                            <span className="text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>{csvFileName}</span>
                            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>Click to choose a different file</span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>Drag &amp; drop your CSV here</span>
                            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>or click to browse — .csv from any booking system</span>
                          </>
                        )}
                      </button>
                      {csvNote && <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{csvNote}</p>}
                      {customerLists.length > 0 && (
                        <div>
                          <label htmlFor="update-target" className="mb-1 block text-[11px] font-medium" style={{ color: "var(--ink-tertiary)" }}>
                            Add to an existing list instead of creating a new one? (re-upload anytime — Meta dedupes automatically)
                          </label>
                          <select id="update-target" className={inputCls} style={inputStyle} value={updateTargetId} onChange={(e) => setUpdateTargetId(e.target.value)}>
                            <option value="">— No, create a new audience —</option>
                            {customerLists.map((a) => (<option key={a.id} value={a.id}>Update: {a.name}</option>))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {spec.fields.map((f) => {
                    if (spec.kind === "CUSTOMER_LIST" && f.key === "name" && updateTargetId) return null;
                    const key = `${spec.kind}.${f.key}`;
                    const options = f.key === "originAudienceLocalId" ? metaBacked.map((a) => ({ v: a.id, l: a.name })) : (f.options ?? []).map((o) => ({ v: o, l: o }));
                    // Coach the engagement name instead of making them invent one.
                    const placeholder = spec.kind === "ENGAGEMENT" && f.key === "name"
                      ? `Suggested: "Page engagers — last ${draft[`ENGAGEMENT.retentionDays`] || "180"} days" (any name works — it only labels the audience in Ads Manager)`
                      : f.help;
                    const nameSuggestions =
                      spec.kind === "ENGAGEMENT" && f.key === "name"
                        ? (() => {
                            const days = draft[`ENGAGEMENT.retentionDays`] || "180";
                            return [`Page engagers — last ${days} days`, "Warm audience — Facebook & Instagram", "Everyone who's interacted with us"];
                          })()
                        : null;
                    return (
                      <div key={f.key}>
                        <label htmlFor={key} className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-tertiary)" }}>
                          {f.label} {f.required && <span style={{ color: "var(--danger)" }}>*</span>}
                        </label>
                        {nameSuggestions && (
                          <div className="mb-1.5">
                            <p className="mb-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                              Not sure what to call it? The name only labels this audience inside Meta Ads Manager — tap one:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {nameSuggestions.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => setDraft((d) => ({ ...d, [key]: s }))}
                                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors hover:brightness-110"
                                  style={{ background: "var(--accent-wash)", color: "var(--accent)", border: "1px solid var(--accent-ring)" }}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {f.type === "textarea" ? (
                          <textarea id={key} className={inputCls} style={inputStyle} rows={4} placeholder={placeholder} value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
                        ) : f.type === "select" ? (
                          <select id={key} className={inputCls} style={inputStyle} value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}>
                            <option value="" disabled>— pick —</option>
                            {options.map((o) => (<option key={o.v} value={o.v}>{o.l}</option>))}
                          </select>
                        ) : (
                          <input id={key} className={inputCls} style={inputStyle} placeholder={placeholder} value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
                        )}
                        {f.type === "select" && <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>{f.help}</p>}
                      </div>
                    );
                  })}

                  {spec.kind === "ENGAGEMENT" && (
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                      What gets created: Meta starts collecting everyone who liked, commented, messaged, or visited your Facebook Page in the
                      window you pick, keeps it fresh automatically, and it appears in the &quot;On your Meta account&quot; list above within minutes.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button onClick={() => create(spec.kind)} disabled={busy} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50" style={{ background: "var(--accent)" }}>
                      {busy ? "Building…" : spec.kind === "CUSTOMER_LIST" && updateTargetId ? "Add to existing list" : spec.createsOnMeta ? "Create on Meta" : "Build blueprint"}
                    </button>
                    <button onClick={() => { setOpenKind(null); setCsvNote(null); }} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setOpenKind(spec.kind); setMsg(null); setLastCreated(null); }}
                  disabled={lookalikeBlocked}
                  className="mt-3 self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
                  title={lookalikeBlocked ? "Build a customer list or engagement audience first — lookalikes need a source." : undefined}
                >
                  {lookalikeBlocked ? "Needs a source audience first" : "Start"}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {/* Built assets */}
      {audiences.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>
            Built with this platform ({audiences.length})
          </h3>
          <div className="space-y-1.5">
            {audiences.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
                <Icon name={KIND_ICON[a.kind] ?? "target"} size="0.95rem" style={{ color: "var(--accent)" }} />
                <span className="font-semibold" style={{ color: "var(--ink-primary)" }}>{a.name}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: a.metaAudienceId ? "var(--success-wash)" : "var(--info-wash)", color: a.metaAudienceId ? "var(--success)" : "var(--info)" }}>
                  {a.metaAudienceId ? "live on Meta" : "blueprint (used by Copilot)"}
                </span>
                <span style={{ color: "var(--ink-muted)" }}>{a.sourceNote}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
