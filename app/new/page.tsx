"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CopilotPlan, CreativeInput } from "@/lib/types";
import { resolveCoverage, corridorsFor, ONTARIO_CITIES, TIER_ORDER, TIER_LABELS, type CoverageTier } from "@/lib/geoOntario";

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
          setHostCity((v) => (v.trim() ? v : geo));
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
  // GTA coverage ladder (primary geo UX) + manual rows (collapsed advanced).
  const [hostCity, setHostCity] = useState("");
  const [coverageTier, setCoverageTier] = useState<CoverageTier>("CITY_PLUS_NEARBY");
  const [useCorridors, setUseCorridors] = useState(true);
  const [showAdvancedGeo, setShowAdvancedGeo] = useState(false);
  const [locations, setLocations] = useState<LocationRow[]>([{ name: "", radiusKm: 15 }]);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [gender, setGender] = useState<"ALL" | "MALE" | "FEMALE">("ALL");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ score: number; verdict: string; gaps: string[]; suggestions: string[] } | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds the current AI call has been running
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
  type JumpStep = 1 | 2 | 3 | 4;
  interface PreflightCheck { item: string; ok: boolean; severity: "error" | "warning"; detail: string; category: "marketing" | "technical"; jumpStep?: JumpStep }
  interface InputRow { label: string; value: string; jumpStep: JumpStep }
  interface AiReadiness { score: number; verdict: string; strengths: string[]; improvements: string[] }
  interface PreflightResult { ready: boolean; hasWarnings: boolean; checks: PreflightCheck[]; inputs: InputRow[]; ai?: AiReadiness }
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);

  // Tick an elapsed-seconds counter while an AI call is in flight, so the long
  // "Consulting AI Copilot" step shows progress instead of appearing frozen.
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

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

  // Resolve the coverage ladder → concrete Meta locations + strategy hints.
  const coverage = useMemo(
    () => resolveCoverage(hostCity, coverageTier, useCorridors),
    [hostCity, coverageTier, useCorridors],
  );

  function buildTargeting() {
    const manual = locations.map((l) => ({ name: l.name.trim(), radiusKm: l.radiusKm })).filter((l) => l.name);
    const resolved = coverage.locations.map((l) => ({ name: l.name, radiusKm: l.radiusKm }));
    return {
      locations: [...resolved, ...manual],
      coverageNote: coverage.coverageNote,
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
        geography: [coverage.coverageNote, ...locations.map((l) => l.name.trim()).filter(Boolean)].filter(Boolean).join(" | "),
        targeting: buildTargeting(),
        budgetDollars,
        budgetType,
        durationDays,
        // Wire the campaign landing URL to each creative's destination so
        // clicks have somewhere to go (creatives have no separate URL field).
        creatives: creatives.map((c) => ({ ...c, filePaths: c.filePaths.filter(Boolean), linkUrl: c.linkUrl || landingPageUrl })),
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

  function jumpTo(step: JumpStep) {
    setPhase("FORM");
    setStep(step as Step);
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
                    Tell us where your event or studio is, then choose how far to reach — we turn that into Meta location
                    targeting for you.
                  </p>

                  <label className="mb-1 block text-xs font-medium text-[var(--ink-tertiary)]">Event / studio city</label>
                  <input
                    className={inputCls}
                    list="ontario-cities"
                    value={hostCity}
                    onChange={(e) => setHostCity(e.target.value)}
                    placeholder="e.g. Milton, ON"
                  />
                  <datalist id="ontario-cities">
                    {ONTARIO_CITIES.map((c) => (
                      <option key={c.name} value={`${c.name}, ON`} />
                    ))}
                  </datalist>

                  <label className="mb-1 mt-3 block text-xs font-medium text-[var(--ink-tertiary)]">How far should this reach?</label>
                  <div className="space-y-1.5">
                    {TIER_ORDER.map((tier) => {
                      const active = coverageTier === tier;
                      const cityShort = hostCity.split(",")[0].trim();
                      return (
                        <label
                          key={tier}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--line-subtle)",
                            background: active ? "var(--accent-wash)" : "transparent",
                          }}
                        >
                          <input type="radio" name="coverage" checked={active} onChange={() => setCoverageTier(tier)} className="h-3.5 w-3.5" />
                          <span>{cityShort ? TIER_LABELS[tier].replace("my city", cityShort) : TIER_LABELS[tier]}</span>
                        </label>
                      );
                    })}
                  </div>

                  {coverageTier === "CITY_PLUS_NEARBY" && corridorsFor(hostCity).length > 0 && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-secondary)]">
                      <input type="checkbox" checked={useCorridors} onChange={(e) => setUseCorridors(e.target.checked)} className="h-3.5 w-3.5" />
                      Include towns along the {corridorsFor(hostCity).join(" & ")} GO transit corridor
                    </label>
                  )}

                  {(coverage.locations.length > 0 || coverage.coverageNote) && (
                    <p className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-secondary)]">
                      <b>Meta targeting:</b>{" "}
                      {coverage.locations.length
                        ? coverage.locations.map((l) => `${l.name} (${l.radiusKm}km)`).join(" · ")
                        : coverage.coverageNote}
                    </p>
                  )}

                  {coverage.hints.map((h, i) => (
                    <p key={i} className="mt-2 rounded-lg bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">💡 {h}</p>
                  ))}

                  <button
                    type="button"
                    onClick={() => setShowAdvancedGeo((v) => !v)}
                    className="mt-3 text-xs text-[var(--ink-tertiary)] hover:underline"
                  >
                    {showAdvancedGeo ? "▾ Hide advanced" : "▸ Advanced: add specific cities / addresses"}
                  </button>
                  {showAdvancedGeo && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-[var(--ink-muted)]">Added on top of your coverage choice above (up to {MAX_RADIUS_KM}km each).</p>
                      {locations.map((loc, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            className={`${inputCls} flex-1`}
                            value={loc.name}
                            onChange={(e) => updateLocation(i, { name: e.target.value })}
                            placeholder="City, neighbourhood, or address"
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
                      {locations.length < 10 && (
                        <button type="button" onClick={addLocation} className="text-sm text-[var(--success)] hover:underline">
                          + Add another location
                        </button>
                      )}
                    </div>
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
                        {c.kind === "CAROUSEL"
                          ? "Image links (Google Drive or https, one per line, 2–10)"
                          : c.kind === "VIDEO"
                            ? "Video — Google Drive share link (or public https URL)"
                            : "Image — Google Drive share link (or public https URL)"}
                      </label>
                      <textarea
                        className={inputCls}
                        rows={c.kind === "CAROUSEL" ? 3 : 1}
                        value={c.filePaths.join("\n")}
                        onChange={(e) => updateCreative(i, { filePaths: e.target.value.split("\n") })}
                        placeholder="https://drive.google.com/file/d/1AbC…/view"
                      />
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        Paste the Drive share link and set its sharing to <b>&ldquo;Anyone with the link&rdquo;</b> so Meta can
                        fetch it at launch — we don&rsquo;t copy or store your media.
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>Headline</label>
                      <input className={inputCls} value={c.headline ?? ""} onChange={(e) => updateCreative(i, { headline: e.target.value })} placeholder="e.g. Book Your 2026 Wedding Date" />
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">The bold line under your image — short and punchy (~5–7 words).</p>
                    </div>
                    <div>
                      <label className={labelCls}>Primary text</label>
                      <textarea
                        className={inputCls}
                        rows={4}
                        value={c.primaryText ?? ""}
                        onChange={(e) => updateCreative(i, { primaryText: e.target.value })}
                        placeholder="e.g. Say “I do” at Hamilton’s all-in-one waterfront venue — intimate weddings up to 80 guests, in-house catering, and a dedicated planner. Now booking spring & summer 2026. Tap to check your date."
                      />
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        The main body of your ad. Lead with your hook in the <b>first ~125 characters</b> — that&rsquo;s what shows
                        before Meta&rsquo;s &ldquo;See more&rdquo; cut-off on mobile. Communicate your <b>offer</b>, <b>what makes you
                        different</b>, and a clear <b>call to action</b>. One to three short sentences almost always beats a wall of text.
                      </p>
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
                <button onClick={() => submitToCopilot()} disabled={busy || !campaignName} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50">
                  {busy ? (<><Spinner /> Consulting AI Copilot… {elapsed}s</>) : "Review with AI Copilot →"}
                </button>
              )}
            </div>
            {busy && step === 4 && (
              <p className="pt-2 text-right text-xs text-[var(--ink-muted)]">
                The AI is analysing your inputs and building a Meta-ready plan — usually 10–30&nbsp;seconds. Please keep this tab open.
              </p>
            )}
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
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:bg-[var(--accent-strong)] disabled:opacity-50"
          >
            {busy ? (<><Spinner /> Re-planning… {elapsed}s</>) : "Submit answers"}
          </button>
        </div>
      )}

      {(phase === "RECEIPT" || phase === "LAUNCHING") && plan && (
        <div className="space-y-5 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">📋 Pre-Launch Review — confirm before you launch</h2>
            <button
              onClick={() => { setPhase("FORM"); setStep(4); }}
              disabled={phase === "LAUNCHING"}
              className="rounded-lg border border-[var(--line-standard)] px-3 py-1.5 text-sm text-[var(--ink-secondary)] hover:bg-[var(--surface-2)] disabled:opacity-30"
            >
              ← Back to edit
            </button>
          </div>
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

          {/* Comprehensive pre-flight check */}
          <div className="rounded-lg border border-[var(--line-subtle)] bg-[var(--surface-2)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--ink-primary)]">Pre-flight check</h3>
              <button
                onClick={() => campaignId && runPreflight(campaignId)}
                disabled={preflightBusy}
                className="flex items-center gap-1.5 text-xs text-[var(--info)] hover:underline disabled:opacity-50"
              >
                {preflightBusy ? (<><Spinner /> Running…</>) : "Re-run"}
              </button>
            </div>
            {preflightBusy && !preflight && (
              <p className="text-sm text-[var(--ink-tertiary)]">Reviewing your inputs, Meta best practices, live account credentials, and an AI readiness rating…</p>
            )}
            {preflight && (
              <div className="space-y-4">
                {/* AI readiness score */}
                {preflight.ai && (() => {
                  const s = preflight.ai.score;
                  const color = s >= 90 ? "var(--success)" : s >= 70 ? "var(--accent)" : s >= 50 ? "var(--warning)" : "var(--danger)";
                  return (
                    <div className="rounded-lg border p-3" style={{ borderColor: color }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[var(--ink-primary)]">AI readiness</span>
                        <span className="text-2xl font-bold" style={{ color }}>{s}<span className="text-sm text-[var(--ink-muted)]">/100</span></span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div className="h-2 rounded-full" style={{ width: `${s}%`, background: color }} />
                      </div>
                      <p className="mt-2 text-xs text-[var(--ink-secondary)]">{preflight.ai.verdict}</p>
                      {preflight.ai.strengths.length > 0 && (
                        <p className="mt-1.5 text-xs text-[var(--ink-tertiary)]"><b className="text-[var(--success)]">Strengths:</b> {preflight.ai.strengths.join(" · ")}</p>
                      )}
                      {preflight.ai.improvements.length > 0 && (
                        <div className="mt-1 text-xs text-[var(--ink-tertiary)]">
                          <b className="text-[var(--warning)]">To improve:</b>
                          <ul className="ml-4 list-disc">{preflight.ai.improvements.map((im, i) => <li key={i}>{im}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Your inputs — review & edit */}
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">Your inputs</h4>
                  <div className="divide-y divide-[var(--line-subtle)] rounded-lg border border-[var(--line-subtle)]">
                    {preflight.inputs.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                        <span className="shrink-0 text-[var(--ink-tertiary)]">{row.label}</span>
                        <span className="flex-1 truncate text-right text-[var(--ink-secondary)]">{row.value}</span>
                        <button onClick={() => jumpTo(row.jumpStep)} className="shrink-0 text-xs text-[var(--info)] hover:underline">Edit</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Marketing readiness */}
                <PreflightCategory
                  title="Marketing readiness"
                  checks={preflight.checks.filter((c) => c.category === "marketing")}
                  onJump={jumpTo}
                />

                {/* Technical */}
                <PreflightCategory
                  title="Technical"
                  checks={preflight.checks.filter((c) => c.category === "technical")}
                  onJump={jumpTo}
                />

                {/* Overall verdict */}
                {!preflight.ready && <p className="text-sm font-semibold text-[var(--danger)]">❌ Resolve the blocking items above before launching.</p>}
                {preflight.ready && preflight.hasWarnings && <p className="text-sm text-[var(--warning)]">⚠️ Ready to launch — review the warnings to get the most from your spend.</p>}
                {preflight.ready && !preflight.hasWarnings && <p className="text-sm font-semibold text-[var(--success)]">✅ All checks passed — ready to launch.</p>}
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

/** Small indeterminate spinner for in-flight AI calls (unknown duration). */
function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black"
      aria-hidden
    />
  );
}

interface PfCheck { item: string; ok: boolean; severity: "error" | "warning"; detail: string; jumpStep?: 1 | 2 | 3 | 4 }

/** A titled group of pre-flight checks with a jump-to-fix button on failures. */
function PreflightCategory({ title, checks, onJump }: { title: string; checks: PfCheck[]; onJump: (s: 1 | 2 | 3 | 4) => void }) {
  if (checks.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">{title}</h4>
      <div className="space-y-1.5 text-sm">
        {checks.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="shrink-0">{c.ok ? "✅" : c.severity === "warning" ? "⚠️" : "❌"}</span>
            <div className="flex-1">
              <b className={c.severity === "warning" && !c.ok ? "text-[var(--warning)]" : ""}>{c.item}</b>{" "}
              <span className="text-[var(--ink-secondary)]">— {c.detail}</span>
            </div>
            {!c.ok && c.jumpStep && (
              <button onClick={() => onJump(c.jumpStep!)} className="shrink-0 rounded border border-[var(--line-standard)] px-2 py-0.5 text-xs text-[var(--info)] hover:bg-[var(--surface-1)]">
                Fix →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
