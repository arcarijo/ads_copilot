import type { Metadata } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { Icon } from "./components/Icon";
import { LogoutButton } from "./components/LogoutButton";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: "Copilot — your promotion co-pilot",
  description: "Puts promoting power in the hands of studio & venue owners — AI runs the day-to-day, you steer with what you know.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const admin = session?.role === "admin";
  // Logged-out visitors only ever reach /login (middleware redirects the rest),
  // which renders the full-bleed marketing landing page with its own chrome —
  // so the authenticated app nav/frame is suppressed until there's a session.
  if (!session) {
    return (
      <html lang="en" className={`${sora.variable} ${jakarta.variable}`}>
        <body className="min-h-screen">{children}</body>
      </html>
    );
  }

  return (
    <html lang="en" className={`${sora.variable} ${jakarta.variable}`}>
      <body className="min-h-screen">
        {/* Committed color moment #1: solid coral nav, not a wash. Dark warm-ink
            text throughout for contrast (coral is too light for white text
            at this size — same pairing as every coral button). */}
        <nav style={{ background: "var(--accent)" }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
            <Link href="/" className="group font-display flex items-center gap-2 text-lg font-bold tracking-tight" style={{ color: "#1a0f08" }}>
              <span className="grid h-8 w-8 place-items-center rounded-full transition-transform duration-300 group-hover:rotate-[30deg]" style={{ background: "rgba(26,15,8,0.16)" }}>
                <Icon name="compass" size="1.15rem" />
              </span>
              Copilot
            </Link>
            <div className="flex items-center gap-1 text-sm font-medium sm:gap-2">
              <Link
                href="/"
                className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[rgba(26,15,8,0.12)] active:bg-[rgba(26,15,8,0.2)]"
                style={{ color: "rgba(26,15,8,0.82)" }}
              >
                Monitor
              </Link>
              <Link
                href="/clients"
                className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[rgba(26,15,8,0.12)] active:bg-[rgba(26,15,8,0.2)]"
                style={{ color: "rgba(26,15,8,0.82)" }}
              >
                {admin ? "Clients" : "My Businesses"}
              </Link>
              {admin && (
                <Link
                  href="/users"
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[rgba(26,15,8,0.12)] active:bg-[rgba(26,15,8,0.2)]"
                  style={{ color: "rgba(26,15,8,0.82)" }}
                >
                  Users
                </Link>
              )}
              <Link
                href="/new"
                className="ml-1 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-4 py-2 font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.97]"
                style={{ background: "#1a0f08", color: "var(--accent)" }}
              >
                <Icon name="plus" size="1rem" className="icon-spin-hover" />
                New Campaign
              </Link>
              {session && <LogoutButton />}
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
