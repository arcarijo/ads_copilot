"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm outline-none transition-colors focus:ring-1";
const inputStyle = { background: "var(--surface-inset)", border: "1px solid var(--line-standard)", color: "var(--ink-primary)" };
const labelCls = "mb-1 block text-xs font-medium";

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  clientIds: string[];
}
interface ClientOption {
  id: string;
  name: string;
  userId: string | null;
}

export function UsersManager({ users, clients }: { users: UserRow[]; clients: ClientOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", passcode: "" });

  // Per-user edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", email: "", passcode: "", clientIds: [] as string[] });

  async function createUser() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`⚠️ ${json.error ?? "Could not create user."}`);
      return;
    }
    setDraft({ name: "", email: "", passcode: "" });
    setShowCreate(false);
    setMsg("✅ User created — share the passcode with them privately.");
    router.refresh();
  }

  function startEdit(u: UserRow) {
    setEditId(u.id);
    setEditDraft({ name: u.name, email: u.email ?? "", passcode: "", clientIds: [...u.clientIds] });
    setMsg(null);
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      name: editDraft.name,
      email: editDraft.email,
      clientIds: editDraft.clientIds,
    };
    if (editDraft.passcode.trim()) body.passcode = editDraft.passcode.trim();
    const res = await fetch(`/api/users/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`⚠️ ${json.error ?? "Save failed."}`);
      return;
    }
    setEditId(null);
    setMsg(editDraft.passcode.trim() ? "✅ Saved — new passcode is active immediately." : "✅ Saved.");
    router.refresh();
  }

  async function removeUser(id: string, name: string) {
    if (!window.confirm(`Delete ${name}'s login? Their businesses stay — they just become unassigned.`)) return;
    setBusy(true);
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  function toggleClient(clientId: string) {
    setEditDraft((d) => ({
      ...d,
      clientIds: d.clientIds.includes(clientId) ? d.clientIds.filter((c) => c !== clientId) : [...d.clientIds, clientId],
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>Users</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-tertiary)" }}>
            Client logins. Each user signs in with their passcode and sees only the businesses you assign them.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate((v) => !v); setMsg(null); }}
          className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[#1a0f08] transition-transform active:scale-[0.97]"
          style={{ background: "var(--accent)" }}
        >
          {showCreate ? "Cancel" : "+ New User"}
        </button>
      </div>

      {msg && <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>{msg}</p>}

      {showCreate && (
        <section className="space-y-3 rounded-[var(--radius-lg)] p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Name</label>
              <input className={inputCls} style={inputStyle} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Jordan (Unity Studio)" />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Email (optional)</label>
              <input className={inputCls} style={inputStyle} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="owner@business.com" />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Passcode (min 8 chars)</label>
              <input className={inputCls} style={inputStyle} value={draft.passcode} onChange={(e) => setDraft({ ...draft, passcode: e.target.value })} placeholder="something-memorable-42" />
            </div>
          </div>
          <button
            onClick={createUser}
            disabled={busy || !draft.name.trim() || draft.passcode.trim().length < 8}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "Creating…" : "Create user"}
          </button>
        </section>
      )}

      {users.length === 0 && !showCreate ? (
        <div className="rounded-[var(--radius-lg)] p-10 text-center" style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}>
          No users yet. Create one and assign their businesses — they log in with just a passcode.
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <section key={u.id} className="rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
              {editId !== u.id ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{u.name}</h3>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                      {u.email || "no email"} · joined {u.createdAt} ·{" "}
                      {u.clientIds.length === 0
                        ? "no businesses assigned"
                        : clients.filter((c) => u.clientIds.includes(c.id)).map((c) => c.name).join(", ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(u)} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
                      Edit / assign
                    </button>
                    <button onClick={() => removeUser(u.id, u.name)} disabled={busy} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs disabled:opacity-50" style={{ border: "1px solid rgba(251,113,133,0.35)", color: "var(--danger)" }}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Name</label>
                      <input className={inputCls} style={inputStyle} value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Email</label>
                      <input className={inputCls} style={inputStyle} value={editDraft.email} onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>New passcode (blank = keep current)</label>
                      <input className={inputCls} style={inputStyle} value={editDraft.passcode} onChange={(e) => setEditDraft({ ...editDraft, passcode: e.target.value })} placeholder="min 8 characters" />
                    </div>
                  </div>
                  <div>
                    <span className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Assigned businesses</span>
                    <div className="flex flex-wrap gap-2">
                      {clients.map((c) => {
                        const mine = editDraft.clientIds.includes(c.id);
                        const ownedByOther = c.userId && c.userId !== u.id && !mine;
                        return (
                          <button
                            key={c.id}
                            onClick={() => toggleClient(c.id)}
                            aria-pressed={mine}
                            className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                            style={
                              mine
                                ? { background: "var(--accent)", color: "#1a0f08" }
                                : { background: "var(--surface-3)", color: "var(--ink-secondary)" }
                            }
                            title={ownedByOther ? "Currently assigned to another user — selecting moves it here." : undefined}
                          >
                            {c.name}
                            {ownedByOther ? " ⚠" : ""}
                          </button>
                        );
                      })}
                      {clients.length === 0 && <span className="text-xs" style={{ color: "var(--ink-muted)" }}>No businesses onboarded yet.</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} disabled={busy} className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50" style={{ background: "var(--accent)" }}>
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditId(null)} className="rounded-[var(--radius-sm)] px-4 py-2 text-sm" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
