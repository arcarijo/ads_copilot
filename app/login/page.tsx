"use client";

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Icon, type IconName } from "../components/Icon";

/* ---------------------------------------------------------------------------
   Copilot — public landing page. Front door to the app, so it extends the
   product's committed design world (warm-charcoal cockpit, coral = the AI's
   voice, plum = the human manager's voice, coral→plum hero gradient, Sora +
   Plus Jakarta Sans) at brand-register scale. Login lives in an accessible
   native <dialog>. See PRODUCT.md / .interface-design/system.md.
--------------------------------------------------------------------------- */

const wrap = "mx-auto w-full max-w-6xl px-6";

/** Scroll-in wrapper. Visible by default; the mount effect arms the hidden
 *  start state so no-JS / SSR renders everything (per impeccable's reveal rule). */
function Reveal({
  children,
  className = "",
  style,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}

function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Hard navigation: bypasses Next's router cache, which still holds the
      // pre-login /login redirect for "/" and would otherwise bounce us back.
      window.location.assign("/");
      return;
    }
    setBusy(false);
    setError(true);
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-label="Sign in" className="pop-in">
      <div
        className="w-[min(92vw,25rem)] rounded-[var(--radius-lg)] p-7"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line-standard)", boxShadow: "0 30px 80px -24px rgba(0,0,0,0.7)" }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
              <Icon name="compass" size="1.25rem" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold" style={{ color: "var(--ink-primary)" }}>Welcome back</h2>
              <p className="text-xs" style={{ color: "var(--ink-tertiary)" }}>Enter your passcode to reach your campaigns.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[var(--surface-3)]"
            style={{ color: "var(--ink-tertiary)" }}
          >
            <Icon name="x" size="1rem" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your passcode"
            aria-label="Passcode"
            className="w-full rounded-[var(--radius-sm)] px-3 py-2.5 text-sm outline-none"
            style={{ background: "var(--surface-inset)", border: "1px solid var(--line-standard)", color: "var(--ink-primary)" }}
          />
          {error && (
            <p className="flex items-center gap-1.5 text-sm" style={{ color: "var(--danger)" }}>
              <Icon name="alert" size="0.9rem" /> That passcode didn&apos;t match — try again.
            </p>
          )}
          <button
            disabled={busy || !password}
            className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-2.5 font-semibold text-[#1a0f08] transition-transform active:scale-[0.97] disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {busy ? <><Icon name="refresh" size="0.9em" className="spin" /> Checking…</> : <>Enter <Icon name="arrow-right" size="0.9em" className="icon-nudge" /></>}
          </button>
          <p className="text-center text-[11px]" style={{ color: "var(--ink-muted)" }}>
            No passcode yet? Your account manager sets one up for you.
          </p>
        </form>
      </div>
    </dialog>
  );
}

function Feature({ icon, title, children, className = "", style }: { icon: IconName; title: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`lift group flex flex-col rounded-[var(--radius-lg)] p-6 ${className}`} style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)", ...style }}>
      <span className="mb-4 grid h-11 w-11 place-items-center rounded-[var(--radius-md)]" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
        <Icon name={icon} size="1.35rem" />
      </span>
      <h3 className="font-display text-lg font-semibold" style={{ color: "var(--ink-primary)" }}>{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{children}</p>
    </div>
  );
}

export default function Landing() {
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-js", "");
  }, []);

  const open = () => setSignIn(true);

  return (
    <div style={{ background: "var(--surface-0)" }}>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} />

      {/* ---- Nav ---- */}
      <header className="sticky top-0 z-30" style={{ background: "rgba(20,17,14,0.82)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--line-subtle)" }}>
        <div className={`${wrap} flex items-center justify-between gap-4 py-3.5`}>
          <a href="#top" className="group flex items-center gap-2 font-display text-lg font-bold tracking-tight" style={{ color: "var(--ink-primary)" }}>
            <span className="grid h-8 w-8 place-items-center rounded-full transition-transform duration-300 group-hover:rotate-[30deg]" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
              <Icon name="compass" size="1.15rem" />
            </span>
            Copilot
          </a>
          <nav className="hidden items-center gap-1 text-sm font-medium sm:flex" style={{ color: "var(--ink-secondary)" }}>
            <a href="#how" className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink-primary)]">How it works</a>
            <a href="#capabilities" className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink-primary)]">Capabilities</a>
            <a href="#security" className="rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink-primary)]">Security</a>
          </nav>
          <button
            onClick={open}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[#1a0f08] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.97]"
            style={{ background: "var(--accent)" }}
          >
            Sign in <Icon name="arrow-right" size="0.85rem" className="icon-nudge" />
          </button>
        </div>
      </header>

      {/* ---- Hero ---- */}
      <section id="top" className="relative overflow-hidden">
        {/* Signature gradient aura — the two voices meeting, one hero moment. */}
        <div aria-hidden className="pointer-events-none absolute -right-1/4 -top-1/3 aura-drift" style={{ width: "70rem", height: "70rem", background: "radial-gradient(circle, rgba(255,122,82,0.20), rgba(154,46,168,0.12) 40%, transparent 68%)", filter: "blur(20px)" }} />
        <div className={`${wrap} relative grid items-center gap-12 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28`}>
          <div>
            <div className="rise-in inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium" style={{ ["--i" as string]: 0, background: "var(--surface-2)", border: "1px solid var(--line-standard)", color: "var(--ink-secondary)" }}>
              <span className="grid h-4 w-4 place-items-center rounded-full" style={{ background: "var(--accent)", color: "#1a0f08" }}><Icon name="check" size="0.62rem" strokeWidth={3} /></span>
              Live on Meta · built for studios &amp; venues
            </div>
            <h1 className="rise-in mt-5 font-display font-bold leading-[0.98] tracking-[-0.03em]" style={{ ["--i" as string]: 1, color: "var(--ink-primary)", fontSize: "clamp(2.6rem, 6vw, 4.5rem)" }}>
              Promoting power, in the hands of the people who know their audience.
            </h1>
            <p className="rise-in mt-6 max-w-xl text-lg leading-relaxed" style={{ ["--i" as string]: 2, color: "var(--ink-secondary)" }}>
              Copilot runs your Meta ad campaigns end to end — structural setup, daily optimization, honest reporting — while every decision that spends money or changes direction waits for you.
            </p>
            <div className="rise-in mt-8 flex flex-wrap items-center gap-3" style={{ ["--i" as string]: 3 }}>
              <button
                onClick={open}
                className="flex items-center gap-2 rounded-[var(--radius-md)] px-6 py-3 font-semibold text-[#1a0f08] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.97]"
                style={{ background: "var(--accent)" }}
              >
                Sign in <Icon name="arrow-right" size="0.95em" className="icon-nudge" />
              </button>
              <a
                href="#how"
                className="flex items-center gap-2 rounded-[var(--radius-md)] px-6 py-3 font-semibold transition-colors hover:bg-[var(--surface-2)]"
                style={{ border: "1px solid var(--line-standard)", color: "var(--ink-primary)" }}
              >
                See how it works
              </a>
            </div>
          </div>

          {/* Hero visual — the two voices, as a real dialogue. */}
          <Reveal className="rise-in" style={{ ["--i" as string]: 2 }}>
            <div className="rounded-[var(--radius-lg)] p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-standard)", boxShadow: "0 40px 90px -40px rgba(0,0,0,0.8)" }}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-tertiary)" }}>The Unity Studio · today</span>
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: "var(--success-wash)", color: "var(--success)" }}>
                  <span className="h-1.5 w-1.5 rounded-full pulse-ring" style={{ background: "var(--success)" }} /> Active
                </span>
              </div>

              {/* Human voice — plum */}
              <div className="rounded-[var(--radius-md)] p-4" style={{ background: "var(--human-wash)", border: "1px solid rgba(167,139,250,0.28)" }}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--human)" }}>
                  <Icon name="target" size="0.85rem" /> Manager Directive · you
                </div>
                <p className="text-sm leading-relaxed" style={{ color: "var(--ink-primary)" }}>
                  “Wedding season’s here — push all-inclusive winter dates and prioritize response speed over raw reach.”
                </p>
              </div>

              <div className="my-2 flex justify-center" aria-hidden>
                <Icon name="arrow-down" size="1.1rem" style={{ color: "var(--ink-muted)" }} />
              </div>

              {/* AI voice — coral */}
              <div className="rounded-[var(--radius-md)] p-4" style={{ background: "var(--accent-wash)", border: "1px solid var(--accent-ring)" }}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--accent)" }}>
                  <Icon name="compass" size="0.85rem" /> Co-Pilot
                </div>
                <p className="text-sm leading-relaxed" style={{ color: "var(--ink-primary)" }}>
                  Re-weighted spend toward your fastest-responding ad set, paused two fatigued creatives, and flagged one lead-time question for you.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    { k: "CTR", v: "2.6%" },
                    { k: "Cost / lead", v: "$27" },
                    { k: "Budget", v: "held" },
                  ].map((m) => (
                    <div key={m.k} className="rounded-[var(--radius-sm)] py-2" style={{ background: "var(--surface-inset)" }}>
                      <div className="font-display text-base font-bold tabular-nums" style={{ color: "var(--ink-primary)" }}>{m.v}</div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>{m.k}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---- Two voices ---- */}
      <section className="py-20" style={{ background: "var(--surface-1)", borderTop: "1px solid var(--line-subtle)", borderBottom: "1px solid var(--line-subtle)" }}>
        <div className={wrap}>
          <Reveal>
            <h2 className="max-w-3xl font-display font-bold tracking-tight" style={{ color: "var(--ink-primary)", fontSize: "clamp(1.9rem, 4vw, 3rem)" }}>
              Two voices, one campaign.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              The whole product lives on one boundary: what the numbers say, and what you know. Copilot never blurs them.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <Reveal delay={40}>
              <div className="h-full rounded-[var(--radius-lg)] p-7" style={{ background: "var(--human-wash)", border: "1px solid rgba(167,139,250,0.28)" }}>
                <span className="mb-4 grid h-11 w-11 place-items-center rounded-[var(--radius-md)]" style={{ background: "rgba(167,139,250,0.18)", color: "var(--human)" }}>
                  <Icon name="target" size="1.35rem" />
                </span>
                <h3 className="font-display text-xl font-semibold" style={{ color: "var(--ink-primary)" }}>You steer</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                  The Manager Directive is one field where your read on the real world — a season, a sold-out weekend, a shift in what sells — overrides the AI’s read on the numbers. Copilot reads it first, every single day, and tells you when your direction has outgrown the campaign.
                </p>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="h-full rounded-[var(--radius-lg)] p-7" style={{ background: "var(--accent-wash)", border: "1px solid var(--accent-ring)" }}>
                <span className="mb-4 grid h-11 w-11 place-items-center rounded-[var(--radius-md)]" style={{ background: "rgba(255,122,82,0.18)", color: "var(--accent)" }}>
                  <Icon name="compass" size="1.35rem" />
                </span>
                <h3 className="font-display text-xl font-semibold" style={{ color: "var(--ink-primary)" }}>It does the disciplined work</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                  The tireless media-buyer checklist a human forgets under pressure: learning-phase patience, kill-loser thresholds, creative-fatigue detection. Copilot works the numbers so you don’t have to — and hands every judgment call back to you.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---- How it works: the daily cycle ---- */}
      <section id="how" className="py-20">
        <div className={wrap}>
          <Reveal>
            <h2 className="font-display font-bold tracking-tight" style={{ color: "var(--ink-primary)", fontSize: "clamp(1.9rem, 4vw, 3rem)" }}>
              A media buyer that shows up every morning.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              One disciplined loop runs every day — and repeats. The AI proposes; hard-coded rules decide what actually reaches Meta.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { n: "01", icon: "chart" as IconName, t: "Fetch", d: "Pulls yesterday’s per-ad numbers from Meta — spend, clicks, conversions, frequency — and writes them to your history." },
              { n: "02", icon: "gauge" as IconName, t: "Think", d: "Reasons like a media buyer against your strategy and directive: which ads to keep, which to pause, where fatigue is setting in." },
              { n: "03", icon: "bolt" as IconName, t: "Act", d: "Pauses losers within hard limits, emails you a plain-English report, and only ever recommends a budget increase — never makes one." },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 60}>
                <div className="relative h-full rounded-[var(--radius-lg)] p-6" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)]" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
                      <Icon name={s.icon} size="1.35rem" />
                    </span>
                    <span className="font-display text-2xl font-bold tabular-nums" style={{ color: "var(--line-strong)" }}>{s.n}</span>
                  </div>
                  <h3 className="font-display text-lg font-semibold" style={{ color: "var(--ink-primary)" }}>{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120}>
            <p className="mt-6 flex items-center gap-2 text-sm" style={{ color: "var(--ink-tertiary)" }}>
              <Icon name="refresh" size="0.95rem" style={{ color: "var(--accent)" }} /> Then it does it again tomorrow — patient through the learning phase, ruthless once the data is in.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---- Capabilities ---- */}
      <section id="capabilities" className="py-20" style={{ background: "var(--surface-1)", borderTop: "1px solid var(--line-subtle)", borderBottom: "1px solid var(--line-subtle)" }}>
        <div className={wrap}>
          <Reveal>
            <h2 className="font-display font-bold tracking-tight" style={{ color: "var(--ink-primary)", fontSize: "clamp(1.9rem, 4vw, 3rem)" }}>
              Everything a campaign needs, translated into what you already know.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              You bring deep knowledge of your customers. Copilot turns it into expert campaigns — no marketing training required.
            </p>
          </Reveal>
          {/* Bento: varied sizes, not an identical grid. */}
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <Reveal className="md:col-span-2" delay={0}>
              <Feature icon="sparkle" title="Pre-launch Co-Pilot" className="h-full">
                Answer a plain-English questionnaire and Copilot returns a complete, Meta-ready campaign plan — objective, budget, audiences, ad sets, creatives — validated against real ad-buying rules. When it needs a detail only you know, it asks first instead of guessing. You approve before a cent is spent.
              </Feature>
            </Reveal>
            <Reveal delay={60}>
              <Feature icon="broadcast" title="Audience Studio" className="h-full">
                Turn your customer knowledge into real Meta audiences: past-client lists, page engagers, lookalikes, and reusable targeting blueprints. Contacts are SHA-256 hashed on our server before they ever reach Meta — raw data is never stored.
              </Feature>
            </Reveal>
            <Reveal delay={90}>
              <Feature icon="pencil" title="Strategy profile" className="h-full">
                Your business as priority-ordered line items, each with “what a media buyer needs here” coaching. An AI “check my work” pass flags the gaps a media buyer would — and only ever warns, never rewrites your words.
              </Feature>
            </Reveal>
            <Reveal className="md:col-span-2" delay={120}>
              <Feature icon="gauge" title="Promoter’s Coach" className="h-full">
                Deterministic, always-on guidance with zero AI cost: profile-depth checks, benchmark comparisons on your CTR and cost-per-lead, directive hygiene, and which platforms actually fit your business. Practical nudges, in plain language, the moment they matter.
              </Feature>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---- Guardrails ---- */}
      <section className="py-20">
        <div className={wrap}>
          <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <Reveal>
              <h2 className="font-display font-bold tracking-tight" style={{ color: "var(--ink-primary)", fontSize: "clamp(1.9rem, 4vw, 3rem)" }}>
                The AI proposes. The code disposes.
              </h2>
              <p className="mt-4 text-lg leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                Real ad money is on the line, so the model never gets the last word. Every action it suggests passes hard-coded rules before anything reaches Meta.
              </p>
              <div className="mt-6 rounded-[var(--radius-md)] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--ink-secondary)" }}>Daily budget ceiling</span>
                  <span className="font-display font-bold tabular-nums" style={{ color: "var(--ink-primary)" }}>$1,000</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-inset)" }}>
                  <div className="h-full rounded-full" style={{ width: "34%", background: "var(--accent)" }} />
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-tertiary)" }}>
                  <Icon name="shield" size="0.85rem" style={{ color: "var(--success)" }} /> The AI can recommend a raise — it can never make one.
                </p>
              </div>
            </Reveal>
            <div className="grid gap-4">
              {[
                { icon: "check" as IconName, t: "Server-side allowlist", d: "Every optimizer action is checked against a fixed set — keep, pause, or recommend — and validated against the campaign’s own ad IDs. Anything unrecognized is refused." },
                { icon: "shield" as IconName, t: "Budget can only go down, automatically", d: "Hard-coded global caps plus a per-campaign ceiling written at approval. Increases always route to a human for sign-off." },
                { icon: "sparkle" as IconName, t: "Anti-hallucination wall", d: "If the AI invents an audience or interest that isn’t really yours, it’s stripped before the plan is ever sent to Meta." },
              ].map((g, i) => (
                <Reveal key={g.t} delay={i * 60}>
                  <div className="flex gap-4 rounded-[var(--radius-md)] p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)]" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
                      <Icon name={g.icon} size="1.2rem" />
                    </span>
                    <div>
                      <h3 className="font-semibold" style={{ color: "var(--ink-primary)" }}>{g.t}</h3>
                      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{g.d}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Security ---- */}
      <section id="security" className="relative overflow-hidden py-20" style={{ background: "var(--surface-1)", borderTop: "1px solid var(--line-subtle)", borderBottom: "1px solid var(--line-subtle)" }}>
        <div className={wrap}>
          <Reveal>
            <div className="flex items-center gap-2.5">
              <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)]" style={{ background: "var(--success-wash)", color: "var(--success)" }}>
                <Icon name="shield" size="1.4rem" />
              </span>
              <h2 className="font-display font-bold tracking-tight" style={{ color: "var(--ink-primary)", fontSize: "clamp(1.9rem, 4vw, 3rem)" }}>
                Built like the tokens matter.
              </h2>
            </div>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              Your ad accounts and access tokens are the keys to real money. They’re defended in depth, at every layer.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "shield" as IconName, t: "Encrypted at rest", d: "Meta tokens and platform credentials are AES-256-GCM encrypted in the database. They never leave the server or appear in any API response." },
              { icon: "user" as IconName, t: "Hardened sign-in", d: "Expiring, HMAC-signed sessions on a dedicated signing key; rate-limited, constant-time login; passcodes stored with a peppered hash." },
              { icon: "grip" as IconName, t: "Row-Level Security", d: "Every database table enforces isolation at the Postgres layer — closing off any path around the application’s own tenant checks." },
              { icon: "globe" as IconName, t: "Locked-down edge", d: "HSTS, clickjacking denial, and content-type protection on every response. The research crawler is SSRF-guarded against internal targets." },
              { icon: "gauge" as IconName, t: "Abuse throttling", d: "Per-user rate limits on the expensive AI endpoints stop runaway cost, keyed so one account can never degrade another." },
              { icon: "users" as IconName, t: "Strict tenant isolation", d: "Owners see only their own businesses, campaigns, and reports. Every route is scoped server-side and audited." },
            ].map((s, i) => (
              <Reveal key={s.t} delay={(i % 3) * 50}>
                <div className="h-full rounded-[var(--radius-md)] p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--line-subtle)" }}>
                  <div className="mb-3 flex items-center gap-2">
                    <Icon name={s.icon} size="1.1rem" style={{ color: "var(--success)" }} />
                    <h3 className="font-semibold" style={{ color: "var(--ink-primary)" }}>{s.t}</h3>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Platforms ---- */}
      <section className="py-20">
        <div className={wrap}>
          <Reveal>
            <h2 className="font-display font-bold tracking-tight" style={{ color: "var(--ink-primary)", fontSize: "clamp(1.7rem, 3.5vw, 2.5rem)" }}>
              Meta today. More on the way.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              Meta campaigns run live end to end. The rest are onboarding-ready — connect now, launches follow.
            </p>
          </Reveal>
          <Reveal delay={60}>
            <div className="mt-8 flex flex-wrap gap-3">
              {[
                { icon: "megaphone" as IconName, name: "Meta", live: true },
                { icon: "search" as IconName, name: "Google", live: false },
                { icon: "music" as IconName, name: "TikTok", live: false },
                { icon: "pin" as IconName, name: "Pinterest", live: false },
                { icon: "briefcase" as IconName, name: "LinkedIn", live: false },
              ].map((p) => (
                <div key={p.name} className="flex items-center gap-2.5 rounded-[var(--radius-md)] px-4 py-3" style={{ background: "var(--surface-1)", border: "1px solid var(--line-subtle)" }}>
                  <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: p.live ? "var(--accent-wash)" : "var(--surface-3)", color: p.live ? "var(--accent)" : "var(--ink-tertiary)" }}>
                    <Icon name={p.icon} size="1rem" />
                  </span>
                  <span className="font-medium" style={{ color: "var(--ink-primary)" }}>{p.name}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: p.live ? "var(--success-wash)" : "var(--surface-3)", color: p.live ? "var(--success)" : "var(--ink-muted)" }}>
                    {p.live ? "Live" : "Soon"}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---- Final CTA ---- */}
      <section className="py-20">
        <div className={wrap}>
          <Reveal>
            <div className="relative overflow-hidden rounded-[var(--radius-lg)] px-8 py-16 text-center" style={{ background: "var(--hero-gradient)" }}>
              <div aria-hidden className="pointer-events-none absolute inset-0 aura-drift" style={{ background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.14), transparent 55%)" }} />
              <h2 className="relative mx-auto max-w-2xl font-display font-bold tracking-tight text-white" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)" }}>
                Ready when you are.
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-lg leading-relaxed" style={{ color: "rgba(255,255,255,0.9)" }}>
                Sign in to reach your campaigns, or ask your account manager for a passcode to get started.
              </p>
              <button
                onClick={open}
                className="relative mt-8 inline-flex items-center gap-2 rounded-[var(--radius-md)] px-7 py-3.5 font-semibold shadow-lg transition-transform hover:-translate-y-0.5 active:scale-[0.97]"
                style={{ background: "#1a0f08", color: "var(--accent)" }}
              >
                Sign in <Icon name="arrow-right" size="0.95em" className="icon-nudge" />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer style={{ borderTop: "1px solid var(--line-subtle)" }}>
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-8`}>
          <div className="flex items-center gap-2 font-display font-bold" style={{ color: "var(--ink-primary)" }}>
            <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: "var(--accent-wash)", color: "var(--accent)" }}>
              <Icon name="compass" size="1rem" />
            </span>
            Copilot
          </div>
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            Your promotion co-pilot — AI runs the day-to-day, you steer with what you know.
          </p>
          <button onClick={open} className="text-sm font-medium transition-colors hover:text-[var(--accent)]" style={{ color: "var(--ink-secondary)" }}>
            Sign in
          </button>
        </div>
      </footer>
    </div>
  );
}
