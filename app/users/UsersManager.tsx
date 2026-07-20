"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const labelCls = "mb-1 block text-xs font-medium";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean;
  lastSignInAt: number | null;
  clientIds: string[];
}
interface ClientOption {
  id: string;
  name: string;
  clerkUserId: string | null;
}

function lastSeen(ts: number | null): string {
  if (!ts) return "never signed in";
  return `last seen ${new Date(ts).toLocaleDateString()}`;
}

/**
 * Admin-only user management. Sign-in/MFA/reset are owned by Clerk; here the
 * admin invites people, grants/removes admin, revokes access, and decides which
 * businesses each user can see. Hard-delete stays in the Clerk dashboard.
 */
export function UsersManager({
  selfId,
  users,
  clients,
}: {
  selfId: string | null;
  users: UserRow[];
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");

  function startEdit(u: UserRow) {
    setEditId(u.id);
    setDraftIds([...u.clientIds]);
    setMsg(null);
  }

  function toggleClient(clientId: string) {
    setDraftIds((d) => (d.includes(clientId) ? d.filter((c) => c !== clientId) : [...d, clientId]));
  }

  async function patch(userId: string, body: Record<string, unknown>, okMsg: string) {
    setBusyId(userId);
    setMsg(null);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setMsg(`⚠️ ${json.error ?? "Action failed."}`);
    setMsg(`✅ ${okMsg}`);
    router.refresh();
  }

  async function invite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setBusyId("invite");
    setMsg(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setMsg(`⚠️ ${json.error ?? "Invite failed."}`);
    setInviteEmail("");
    setMsg(`✅ Invite sent to ${email}.`);
    router.refresh();
  }

  async function saveAssignment(userId: string) {
    await patch(userId, { clientIds: draftIds }, "Assignments saved.");
    setEditId(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--ink-primary)" }}>Users</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-tertiary)" }}>
          Invite people, grant admin, revoke access, and choose which businesses each person can see.
          Sign-in, MFA, and password resets are handled by Clerk.
        </p>
      </div>

      {/* Invite */}
      <div className="rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
        <label className={labelCls} style={{ color: "var(--ink-tertiary)" }}>Invite a new user by email</label>
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invite()}
            placeholder="person@business.com"
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line-standard)] bg-[var(--surface-1)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={invite}
            disabled={busyId === "invite" || !inviteEmail.trim()}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {busyId === "invite" ? "Sending…" : "Send invite"}
          </button>
        </div>
      </div>

      {msg && <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>{msg}</p>}

      {users.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] p-10 text-center" style={{ border: "1px dashed var(--line-standard)", color: "var(--ink-tertiary)" }}>
          No users yet. Invite someone above; once they accept and sign in they&apos;ll appear here.
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => {
            const isSelf = u.id === selfId;
            const isAdmin = u.role === "admin";
            const busy = busyId === u.id;
            return (
              <section key={u.id} className="rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)", opacity: u.banned ? 0.7 : 1 }}>
                {editId !== u.id ? (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{u.name}</h3>
                        {isAdmin && <Badge label="Admin" wash="var(--accent-wash)" color="var(--accent)" />}
                        {isSelf && <Badge label="You" wash="var(--surface-3)" color="var(--ink-tertiary)" />}
                        {u.banned && <Badge label="Revoked" wash="var(--danger-wash)" color="var(--danger)" />}
                      </div>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                        {u.email || "no email"} · {lastSeen(u.lastSignInAt)}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                        {u.clientIds.length === 0
                          ? "no businesses assigned"
                          : clients.filter((c) => u.clientIds.includes(c.id)).map((c) => c.name).join(", ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => startEdit(u)} disabled={busy} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs disabled:opacity-50" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
                        Assign businesses
                      </button>
                      {!isSelf && (
                        <button
                          onClick={() => patch(u.id, { admin: !isAdmin }, isAdmin ? "Admin removed." : "Admin granted.")}
                          disabled={busy}
                          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs disabled:opacity-50"
                          style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}
                        >
                          {isAdmin ? "Remove admin" : "Make admin"}
                        </button>
                      )}
                      {!isSelf && (
                        <button
                          onClick={() => patch(u.id, { banned: !u.banned }, u.banned ? "Access restored." : "Access revoked.")}
                          disabled={busy}
                          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          style={u.banned
                            ? { border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }
                            : { background: "var(--danger-wash)", color: "var(--danger)", border: "1px solid var(--danger)" }}
                        >
                          {busy ? "…" : u.banned ? "Restore" : "Revoke"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h3 className="font-display text-sm font-semibold" style={{ color: "var(--ink-primary)" }}>{u.name}</h3>
                    <div>
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
                              style={mine ? { background: "var(--accent)", color: "#1a0f08" } : { background: "var(--surface-3)", color: "var(--ink-secondary)" }}
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
                      <button onClick={() => saveAssignment(u.id)} disabled={busy} className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50" style={{ background: "var(--accent)" }}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditId(null)} className="rounded-[var(--radius-sm)] px-4 py-2 text-sm" style={{ border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Badge({ label, wash, color }: { label: string; wash: string; color: string }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: wash, color }}>
      {label}
    </span>
  );
}
