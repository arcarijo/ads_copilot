"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={logout}
      className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[rgba(26,15,8,0.12)] active:bg-[rgba(26,15,8,0.2)]"
      style={{ color: "rgba(26,15,8,0.62)" }}
    >
      Sign out
    </button>
  );
}
