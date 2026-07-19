"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const labelCls = "mb-1 block text-xs font-medium";

interface UserRow {
  id: string;
  name: string;
  email: string;
  clientIds: string[];
}
interface ClientOption {
  id: string;
  name: string;
  clerkUserId: string | null;
}

/**
 * Admin-only client assignment. Users sign in through Clerk (magic-link/Google,
 * optional MFA) and are created/removed in the Clerk dashboard — here the admin
 * only decides which businesses each user can see.
 */
export function UsersManager({ users, clients }: { users: UserRow[]; clients: ClientOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  function startEdit(u: UserRow) {
    setEditId(u.id);
    setDraftIds([...u.clientIds]);
    setMsg(null);
  }

  function toggleClient(clientId: string) {
    setDraftIds((d) => (d.includes(clientId) ? d.filter((c) => c !== clientId) : [...d, clientId]));
  }

  async function save(userId: string) {
    setBusy(true);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientIds: draftIds }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`⚠️ ${json.error ?? "Save failed."}`);
      return;
    }
    setEditId(null);
    setMsg("✅ Assignments saved.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>Users</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-tertiary)" }}>
          Sign-in is handled by Clerk — add or remove people in the Clerk dashboard. Here you choose which
          businesses each person can see.
        </p>
      </div>

      {msg && <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>{msg}</p>}

      {users.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] p-10 text-center" style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}>
          No users yet. Invite people from the Clerk dashboard; once they sign in they&apos;ll appear here to assign.
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
                      {u.email || "no email"} ·{" "}
                      {u.clientIds.length === 0
                        ? "no businesses assigned"
                        : clients.filter((c) => u.clientIds.includes(c.id)).map((c) => c.name).join(", ")}
                    </p>
                  </div>
                  <button onClick={() => startEdit(u)} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
                    Assign businesses
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <h3 className="font-display text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{u.name}</h3>
                    <span className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Assigned businesses</span>
                    <div className="flex flex-wrap gap-2">
                      {clients.map((c) => {
                        const mine = draftIds.includes(c.id);
                        const ownedByOther = c.clerkUserId && c.clerkUserId !== u.id && !mine;
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
                    <button onClick={() => save(u.id)} disabled={busy} className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50" style={{ background: "var(--accent)" }}>
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
