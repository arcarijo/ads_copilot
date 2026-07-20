"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CopilotPlan, CreativeInput } from "@/lib/types";

interface ClientOption {
  id: string;
  name: string;
  status: string;
}

interface LocationRow {
  name: string;
  radiusKm: number;
}
const MAX_RADIUS_KM = 80; // Meta's custom-location ceiling

type Step = 1 | 2 | 3 | 4;
type Phase = "FORM" | "CLARIFY" | "RECEIPT" | "LAUNCHING";

const inputCls =
  "w-full rounded-lg border border-[var(--line-standard)] bg-[var(--surface-1)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const labelCls = "mb-1 block text-sm font-medium text-[var(--ink-secondary)]";

export default function NewCampaign() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>("FORM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((j) => {
        const list = j.clients ?? [];
        setClients(list);
        // Non-admins must pick one of their businesses; preselect when obvious.
        if (list.length === 1) setClientId((prev) => prev || list[0].id);
      })
      .catch(() => {});
    fetch("/api/me")
      .then((r) => r.json())
      .then((j) => setIsAdmin(j.role === "admin"))
      .catch(() => {});
  }, []);

  // When a client is chosen, pre-fill audience & geography from their strategy
  // profile — the profile is ongoing ground truth. Never clobber typed input.
  useEffect(() => {
    if (!clientId) { setPrefillNote(null); return; }
    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((j) => {
        const sj = j.client?.profile?.sectionsJson;
        if (!sj) return;
        let sections: Record<string, string> = {};
        try { sections = JSON.parse(sj); } catch { return; }
        const filled: string[] = [];
        const aud = (sections.audiences ?? "").trim();
        const geo = (sections.geography ?? "").trim();
        if (aud) { setTargetAudience((v) => (v.trim() ? v : aud)); filled.push("audience"); }
        if (geo) {
          setLocations((locs) => (locs.length === 1 && !locs[0].name.trim() ? [{ name: geo, radiusKm: locs[0].radiusKm }] : locs));
          filled.push("location");
        }
        setPrefillNote(filled.length ? `Pre-filled ${filled.join(" & ")} from this client's strategy profile — edit freely.` : null);
      })
      .catch(() => {});
  }, [clientId]);

  // Questionnaire state
  const [campaignName, setCampaignName] = useState("");
  const [goal, setGoal] = useState("Booking inquiries");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([{ name: "", radiusKm: 15 }]);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [gender, setGender] = useState<"ALL" | "MALE" | "FEMALE">("ALL");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ score: number; verdict: string; gaps: string[]; suggestions: string[] } | null>(null);
  const [budgetDollars, setBudgetDollars] = useState(250);
  const [budgetType, setBudgetType] = useState<"DAILY" | "LIFETIME">("LIFETIME");
  const [durationDays, setDurationDays] = useState(14);
  const [abTest, setAbTest] = useState(false);
  const [abVariable, setAbVariable] = useState<"CREATIVE" | "AUDIENCE">("CREATIVE");
  const [abNotes, setAbNotes] = useState("");
  const [campaignDirective, setCampaignDirective] = useState("");

  // Daily optimizer runs at 09:00 UTC (vercel.json cron). Show it in the
  // viewer's local time so they know their deadline to set directives.
  const localCheckTime = useMemo(() => {
    try {
      const d = new Date();
      d.setUTCHours(9, 0, 0, 0);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch {
      return "";
    }
  }, []);
  const [creatives, setCreatives] = useState<CreativeInput[]>([
    { kind: "IMAGE", label: "Creative A", filePaths: [""], primaryText: "", headline: "", linkUrl: "" },
  ]);

  // Copilot state
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<CopilotPlan | null>(null);

  // Preflight validation
  interface PreflightCheck { item: string; ok: boolean; severity: "error" | "warning"; detail: string }
  interface PreflightResult { ready: boolean; hasWarnings: boolean; checks: PreflightCheck[] }
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);

  function updateLocation(i: number, patch: Partial<LocationRow>) {
    setLocations((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function addLocation() {
    setLocations((ls) => (ls.length < 10 ? [...ls, { name: "", radiusKm: 15 }] : ls));
  }
  function removeLocation(i: number) {
    setLocations((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  }

  function updateCreative(i: number, patch: Partial<CreativeInput>) {
    setCreatives((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  function addCreative() {
    setCreatives((cs) => [
      ...cs,
      { kind: "IMAGE", label: `Creative ${String.fromCharCode(65 + cs.length)}`, filePaths: [""], primaryText: "", headline: "", linkUrl: "" },
    ]);
  }

  function buildTargeting() {
    return {
      locations: locations.map((l) => ({ name: l.name.trim(), radiusKm: l.radiusKm })).filter((l) => l.name),
      ageMin: ageMin === "" ? undefined : Number(ageMin),
      ageMax: ageMax === "" ? undefined : Number(ageMax),
      gender,
    };
  }

  async function checkTargeting() {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/campaigns/check-targeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, targetAudience, targeting: buildTargeting() }),
      });
      const json = await res.json();
      setCheckResult(json.error ? { score: 0, verdict: json.error, gaps: [], suggestions: [] } : json);
    } catch {
      setCheckResult({ score: 0, verdict: "Couldn't run the check. Try again.", gaps: [], suggestions: [] });
    }
    setChecking(false);
  }

  async function submitToCopilot(clarificationAnswers?: Record<string, string>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: campaignId ?? undefined,
        clientId: clientId || undefined,
        campaignName,
        goal,
        landingPageUrl,
        targetAudience,
        geography: locations.map((l) => `${l.name.trim()} (${l.radiusKm}km)`).filter((s) => s.length > 6).join("; "),
        targeting: buildTargeting(),
        budgetDollars,
        budgetType,
        durationDays,
        creatives: creatives.map((c) => ({ ...c, filePaths: c.filePaths.filter(Boolean) })),
        abTest,
        abVariable: abTest ? abVariable : undefined,
        abNotes: abTest ? abNotes : undefined,
        campaignDirective,
        clarificationAnswers,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.error) {
      setError(json.error);
      return;
    }
    setCampaignId(json.campaignId);
    if (json.status === "NEEDS_CLARIFICATION") {
      setQuestions(json.questions ?? []);
      setAnswers({});
      setPhase("CLARIFY");
    } else {
      setPlan(json.plan);
      setPhase("RECEIPT");
      runPreflight(json.campaignId);
    }
  }

  async function runPreflight(cid: string) {
    setPreflightBusy(true);
    setPreflight(null);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${cid}/preflight`, { method: "POST" });
      const json = (await res.json()) as PreflightResult;
      setPreflight(json);
    } catch {
      setError("Preflight check could not run. Try again.");
    }
    setPreflightBusy(false);
  }

  async function approveAndLaunch() {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    setPhase("LAUNCHING");
    const res = await fetch(`/api/campaigns/${campaignId}/launch`, { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setError(json.error);
      if (json.preflight) setPreflight(json.preflight as PreflightResult);
      setPhase("RECEIPT");
      return;
    }
    router.push(`/campaigns/${campaignId}`);
  }

  const steps = ["Basics", "Audience", "Budget & Schedule", "Creatives & A/B"];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">New Campaign</h1>

      {error && (
        <div className="rounded-xl border border-[var(--line-standard)] bg-[var(--danger-wash)] p-4 text-sm text-[var(--danger)]">{error}</div>
      )}

      {phase === "FORM" && (
        <>
          <ol className="flex gap-2 text-xs">
            {steps.map((s, i) => (
              <li
                key={s}
                className={`rounded-full px-3 py-1 ${i + 1 === step ? "bg-[var(--accent)] text-black" : i + 1 < step ? "bg-[var(--surface-3)]" : "bg-[var(--surface-1)] text-[var(--ink-muted)]"}`}
              >
                {i + 1}. {s}
              </li>
            ))}
          </ol>

          <div className="space-y-4 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-6">
            {step === 1 && (
              <>
                <div>
                  <label className={labelCls}>Client</label>
                  <select className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    {isAdmin ? (
                      <option value="">— No client (legacy env credentials) —</option>
                    ) : (
                      <option value="" disabled>— Pick your business —</option>
                    )}
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.status !== "VERIFIED" ? `(${c.status})` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    The client&apos;s strategy profile becomes the AI&apos;s ground truth for this campaign.
                  </p>
                  {prefillNote && <p className="mt-1 text-xs text-[var(--success)]">✓ {prefillNote}</p>}
                </div>
                <div>
                  <label className={labelCls}>Campaign name</label>
                  <input className={inputCls} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Spring wedding bookings" />
                </div>
                <div>
                  <label className={labelCls}>What outcome do you want?</label>
                  <select className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)}>
                    <option>Booking inquiries</option>
                    <option>Website traffic</option>
                    <option>Brand awareness</option>
                    <option>Direct sales</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Landing page URL</label>
                  <input className={inputCls} value={landingPageUrl} onChange={(e) => setLandingPageUrl(e.target.value)} placeholder="https://yourvenue.com/book" />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <label className={labelCls}>Describe your target audience</label>
                  <textarea
                    className={inputCls}
                    rows={4}
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="e.g. Engaged couples aged 25–40 within ~40 min of Hamilton, planning intimate weddings under 80 guests. They value photography, local vendors, and an all-in-one venue."
                  />
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Your AI Copilot reads this and builds real Meta targeting from it. Be specific — cover <b>who</b> they
                    are (age, life stage, interests), <b>what they want</b>, and <b>what makes them a good fit</b>. Vague
                    answers like &ldquo;everyone nearby&rdquo; give the AI little to work with.
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Where should this campaign target?</label>
                  <p className="mb-2 text-xs text-[var(--ink-muted)]">
                    Add the cities, neighbourhoods, or addresses this campaign should reach, each with a radius (Meta allows
                    up to {MAX_RADIUS_KM}km). The app validates and formats these into Meta&rsquo;s location targeting — no guesswork.
                  </p>
                  <div className="space-y-2">
                    {locations.map((loc, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          className={`${inputCls} flex-1`}
                          value={loc.name}
                          onChange={(e) => updateLocation(i, { name: e.target.value })}
                          placeholder="City, neighbourhood, or address — e.g. Hamilton, ON"
                        />
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={MAX_RADIUS_KM}
                            className={`${inputCls} w-20`}
                            value={loc.radiusKm}
                            onChange={(e) => {
                              const n = Math.round(Number(e.target.value));
                              updateLocation(i, { radiusKm: Number.isFinite(n) && n > 0 ? Math.min(MAX_RADIUS_KM, n) : 1 });
                            }}
                          />
                          <span className="text-xs text-[var(--ink-muted)]">km</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLocation(i)}
                          disabled={locations.length === 1}
                          className="rounded-lg border border-[var(--line-standard)] px-2 py-2 text-xs text-[var(--ink-tertiary)] disabled:opacity-30"
                          aria-label="Remove location"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {locations.length < 10 && (
                    <button type="button" onClick={addLocation} className="mt-2 text-sm text-[var(--success)] hover:underline">
                      + Add another location
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>
                      Age range <span className="font-normal text-[var(--ink-muted)]">— optional</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="number" min={18} max={65} className={`${inputCls} w-full`} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="18" />
                      <span className="text-xs text-[var(--ink-muted)]">to</span>
                      <input type="number" min={18} max={65} className={`${inputCls} w-full`} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="65" />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>
                      Gender <span className="font-normal text-[var(--ink-muted)]">— optional</span>
                    </label>
                    <select className={inputCls} value={gender} onChange={(e) => setGender(e.target.value as "ALL" | "MALE" | "FEMALE")}>
                      <option value="ALL">All</option>
                      <option value="MALE">Men</option>
                      <option value="FEMALE">Women</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-[var(--ink-muted)]">Leave age/gender blank to let the AI decide from your audience description.</p>

                <div className="rounded-lg border border-[var(--line-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-[var(--ink-primary)]">Not sure it&rsquo;s enough for Meta?</span>
                    <button
                      type="button"
                      onClick={checkTargeting}
                      disabled={checking || !targetAudience.trim()}
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50"
                    >
                      {checking ? "Checking…" : "Check my targeting"}
                    </button>
                  </div>
                  {checkResult && (
                    <div className="mt-3 space-y-2 text-xs">
                      <p className="font-medium text-[var(--ink-primary)]">
                        Readiness: {checkResult.score}/100 —{" "}
                        <span className="font-normal text-[var(--ink-secondary)]">{checkResult.verdict}</span>
                      </p>
                      {checkResult.gaps.length > 0 && (
                        <div>
                          <p className="font-medium text-[var(--warning)]">Gaps</p>
                          <ul className="list-disc pl-5 text-[var(--ink-secondary)]">
                            {checkResult.gaps.map((g, i) => (
                              <li key={i}>{g}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {checkResult.suggestions.length > 0 && (
                        <div>
                          <p className="font-medium text-[var(--success)]">Suggestions</p>
                          <ul className="list-disc pl-5 text-[var(--ink-secondary)]">
                            {checkResult.suggestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <label className={labelCls}>Budget (USD/CAD, $100–$1000)</label>
                  <input type="number" min={100} max={1000} className={inputCls} value={budgetDollars} onChange={(e) => setBudgetDollars(Number(e.target.value))} />
                </div>
                <div>
                  <label className={labelCls}>Budget type</label>
                  <select className={inputCls} value={budgetType} onChange={(e) => setBudgetType(e.target.value as "DAILY" | "LIFETIME")}>
                    <option value="LIFETIME">Lifetime (total for the run)</option>
                    <option value="DAILY">Daily</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Run duration (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    className={inputCls}
                    value={durationDays}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      setDurationDays(Number.isFinite(n) && n > 0 ? Math.min(90, n) : 1);
                    }}
                  />
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">How many days this campaign runs (1–90).</p>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                {creatives.map((c, i) => (
                  <div key={i} className="space-y-3 rounded-lg border border-[var(--line-subtle)] p-4">
                    <div className="flex items-center justify-between">
                      <input className={`${inputCls} max-w-40 font-medium`} value={c.label} onChange={(e) => updateCreative(i, { label: e.target.value })} />
                      <select className={`${inputCls} max-w-32`} value={c.kind} onChange={(e) => updateCreative(i, { kind: e.target.value as CreativeInput["kind"] })}>
                        <option value="IMAGE">Single image</option>
                        <option value="CAROUSEL">Carousel</option>
                        <option value="VIDEO">Video</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>
                        {c.kind === "CAROUSEL" ? "Image file paths (one per line, 2–10)" : c.kind === "VIDEO" ? "Video file path" : "Image file path"}
                      </label>
                      <textarea
                        className={inputCls}
                        rows={c.kind === "CAROUSEL" ? 3 : 1}
                        value={c.filePaths.join("\n")}
                        onChange={(e) => updateCreative(i, { filePaths: e.target.value.split("\n") })}
                        placeholder={c.kind === "VIDEO" ? "/assets/venue-tour.mp4" : "/assets/venue-hero.jpg"}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Headline</label>
                        <input className={inputCls} value={c.headline ?? ""} onChange={(e) => updateCreative(i, { headline: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>Primary text</label>
                        <input className={inputCls} value={c.primaryText ?? ""} onChange={(e) => updateCreative(i, { primaryText: e.target.value })} />
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={addCreative} className="text-sm text-[var(--success)] hover:underline">+ Add another creative</button>

                <div className="rounded-lg border border-[var(--line-subtle)] p-4">
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={abTest} onChange={(e) => setAbTest(e.target.checked)} className="h-4 w-4" />
                    <span className="font-medium">Enable A/B split test at launch</span>
                    <span className="text-xs text-[var(--ink-muted)]">— optional</span>
                  </label>
                  <p className="mt-1 pl-7 text-xs text-[var(--ink-muted)]">
                    Leave this off to launch a single, non-split campaign. You can launch with just one creative.
                  </p>
                  {abTest && (
                    <div className="mt-3">
                      <label className={labelCls}>Split-test variable</label>
                      <select className={inputCls} value={abVariable} onChange={(e) => setAbVariable(e.target.value as "CREATIVE" | "AUDIENCE")}>
                        <option value="CREATIVE">Creatives (needs 2+ creatives)</option>
                        <option value="AUDIENCE">Audiences</option>
                      </select>
                      {abVariable === "CREATIVE" && creatives.length < 2 && (
                        <p className="mt-2 rounded-lg bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">
                          ⚠️ Only one creative added. A creative split needs 2+. It will launch as a single campaign unless you add another creative above — or turn A/B off.
                        </p>
                      )}
                      <div className="mt-3">
                        <label className={labelCls}>What&rsquo;s different between A and B — and what should the AI watch for?</label>
                        <textarea
                          className={inputCls}
                          rows={3}
                          value={abNotes}
                          onChange={(e) => setAbNotes(e.target.value)}
                          placeholder="e.g. A leads with a video venue tour, B with a photo + starting price. Watch which drives more booking inquiries at a lower cost per lead; favour the winner after ~50 conversions."
                        />
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          The Copilot uses this to judge the test each day and lean toward the winner. Editable after launch.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Campaign directive + daily-check transparency */}
                <div className="rounded-lg border border-[var(--line-subtle)] p-4">
                  <label className={labelCls}>
                    Campaign directive <span className="font-normal text-[var(--ink-muted)]">— optional</span>
                  </label>
                  <textarea
                    className={inputCls}
                    rows={3}
                    value={campaignDirective}
                    onChange={(e) => setCampaignDirective(e.target.value)}
                    placeholder="e.g. Prioritise weekday corporate bookings over weekend weddings for this campaign; keep spend flat; favour the video creative."
                  />
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Context and goals specific to <b>this campaign</b> — separate from your business-wide Manager Directive.
                    The AI weighs it first every day, and you can edit it after launch.
                  </p>
                  <p className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-secondary)]">
                    ⏱️ The AI reviews and optimizes daily at <b>9:00&nbsp;AM UTC</b>
                    {localCheckTime ? ` (${localCheckTime} your time)` : ""}. Set or update directives before then to steer the next check.
                  </p>
                </div>
              </>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
                disabled={step === 1}
                className="rounded-lg border border-[var(--line-standard)] px-4 py-2 text-sm disabled:opacity-30"
              >
                Back
              </button>
              {step < 4 ? (
                <button onClick={() => setStep((s) => Math.min(4, s + 1) as Step)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black hover:bg-[var(--accent-strong)]">
                  Next
                </button>
              ) : (
                <button onClick={() => submitToCopilot()} disabled={busy || !campaignName} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50">
                  {busy ? "Consulting AI Copilot…" : "Review with AI Copilot →"}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {phase === "CLARIFY" && (
        <div className="space-y-4 rounded-xl border border-[var(--line-standard)] bg-[var(--warning-wash)] p-6">
          <h2 className="font-semibold text-[var(--warning)]">🤖 The Copilot needs a few details before building your plan</h2>
          {questions.map((q) => (
            <div key={q}>
              <label className={labelCls}>{q}</label>
              <input className={inputCls} value={answers[q] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))} />
            </div>
          ))}
          <button
            onClick={() => submitToCopilot(answers)}
            disabled={busy || questions.some((q) => !answers[q]?.trim())}
            className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50"
          >
            {busy ? "Re-planning…" : "Submit answers"}
          </button>
        </div>
      )}

      {(phase === "RECEIPT" || phase === "LAUNCHING") && plan && (
        <div className="space-y-5 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-6">
          <h2 className="text-lg font-semibold">📋 Campaign Receipt — review before launch</h2>
          <table className="w-full text-sm">
            <tbody className="[&_td]:py-1.5">
              <tr><td className="w-40 text-[var(--ink-tertiary)]">Campaign</td><td className="font-medium">{plan.campaign.name}</td></tr>
              <tr><td className="text-[var(--ink-tertiary)]">Objective</td><td>{plan.campaign.objective}</td></tr>
              <tr><td className="text-[var(--ink-tertiary)]">Budget</td><td className="font-semibold text-[var(--success)]">${(plan.campaign.budgetCents / 100).toFixed(2)} {plan.campaign.budgetType === "DAILY" ? "per day" : "lifetime"}</td></tr>
              <tr><td className="text-[var(--ink-tertiary)]">Duration</td><td>{durationDays} days</td></tr>
              <tr><td className="text-[var(--ink-tertiary)]">Ad sets</td><td>{plan.adSets.map((a) => `${a.name}${a.variant ? ` (${a.variant})` : ""}`).join(" · ")}</td></tr>
              <tr><td className="text-[var(--ink-tertiary)]">Ads</td><td>{plan.ads.map((a) => a.name).join(" · ")}</td></tr>
            </tbody>
          </table>
          <div className="rounded-lg bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-secondary)]">
            <span className="font-medium text-[var(--ink-primary)]">Strategist rationale: </span>
            {plan.rationale}
          </div>
          <p className="text-xs text-[var(--ink-muted)]">
            This budget becomes a database-enforced ceiling. The daily optimizer can pause underperformers but can never
            raise spend without your emailed approval. It reviews this campaign daily at <b>9:00&nbsp;AM UTC</b>
            {localCheckTime ? ` (${localCheckTime} your time)` : ""}.
          </p>

          {/* Preflight validation gate */}
          <div className="rounded-lg border border-[var(--line-subtle)] bg-[var(--surface-2)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--ink-primary)]">Pre-launch checks</h3>
              <button
                onClick={() => campaignId && runPreflight(campaignId)}
                disabled={preflightBusy}
                className="text-xs text-[var(--info)] hover:underline disabled:opacity-50"
              >
                {preflightBusy ? "Running…" : "Re-run"}
              </button>
            </div>
            {preflightBusy && !preflight && <p className="text-sm text-[var(--ink-tertiary)]">Validating plan, budget, creatives, targeting, and live Meta credentials…</p>}
            {preflight && (
              <div className="space-y-1.5 text-sm">
                {preflight.checks.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span>{c.ok ? "✅" : c.severity === "warning" ? "⚠️" : "❌"}</span>
                    <div><b className={c.severity === "warning" && !c.ok ? "text-[var(--warning)]" : ""}>{c.item}</b> <span className="text-[var(--ink-secondary)]">— {c.detail}</span></div>
                  </div>
                ))}
                {!preflight.ready && <p className="pt-1 text-sm font-semibold text-[var(--danger)]">❌ Resolve the blocking items above before launching.</p>}
                {preflight.ready && preflight.hasWarnings && <p className="pt-1 text-sm text-[var(--warning)]">⚠️ Ready to launch, but review the warnings above.</p>}
                {preflight.ready && !preflight.hasWarnings && <p className="pt-1 text-sm font-semibold text-[var(--success)]">✅ All checks passed — ready to launch.</p>}
              </div>
            )}
          </div>

          <button
            onClick={approveAndLaunch}
            disabled={busy || preflightBusy || !preflight?.ready}
            className="w-full rounded-lg bg-[var(--accent)] py-3 font-semibold text-black hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "LAUNCHING" ? "Launching to Meta…" : preflight?.ready ? "✅ Approve & Launch" : "Launch blocked — checks not passed"}
          </button>
        </div>
      )}
    </div>
  );
}
