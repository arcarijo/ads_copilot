"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CopilotPlan, CreativeInput } from "@/lib/types";
import { resolveCoverage, corridorsFor, ONTARIO_CITIES, TIER_ORDER, TIER_LABELS, type CoverageTier } from "@/lib/geoOntario";
import { CAMPAIGN_INTENTS, INTENT_DEFS, intentApproachNudge, type CampaignIntent } from "@/lib/campaignIntent";
import { getCheckResolution } from "@/lib/preflightResolutions";

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

// Per-kind visual coding for creative cards so a mixed set is scannable at a
// glance (the wizard allows image/video/carousel side by side).
const KIND_STYLE: Record<CreativeInput["kind"], { border: string; wash: string; label: string; accent: string }> = {
  IMAGE: { border: "var(--info)", wash: "var(--info-wash)", label: "🖼️ Single image", accent: "var(--info)" },
  VIDEO: { border: "var(--accent)", wash: "var(--accent-wash)", label: "🎬 Video", accent: "var(--accent)" },
  CAROUSEL: { border: "var(--human)", wash: "var(--human-wash)", label: "🎠 Carousel", accent: "var(--human)" },
};

// Plain-language "when should I pick this?" guidance for owners with zero Meta
// experience. Shown live on each card based on the chosen format.
const KIND_GUIDE: Record<CreativeInput["kind"], { bestFor: string; effort: string; tip: string }> = {
  IMAGE: {
    bestFor: "One strong photo with a clear offer — the simplest, fastest, cheapest ad to make.",
    effort: "Easiest to produce",
    tip: "Best starting point if you're unsure. Use your most striking venue or event photo.",
  },
  VIDEO: {
    bestFor: "Showing your space in motion — walkthroughs, event vibes, testimonials. Highest engagement.",
    effort: "Needs a decent video",
    tip: "Great for emotion and awareness. Even a 15–30s phone clip of the room set up for an event works.",
  },
  CAROUSEL: {
    bestFor: "2–10 swipeable images — show multiple spaces, packages, or tell a step-by-step story.",
    effort: "Needs several photos",
    tip: "Best when you have more than one thing to show (e.g. ceremony space, reception hall, patio).",
  },
};

/** Client-side check: is this a Google Drive FOLDER share link? (mirrors the
 * server's extractDriveFolderId; kept local so no server module is bundled.) */
function isDriveFolderLink(v: string): boolean {
  return /^https?:\/\/(drive|docs)\.google\.com\/.*\/folders\/[A-Za-z0-9_-]{10,}/i.test((v ?? "").trim());
}

interface FolderCheck {
  checking: boolean;
  ok?: boolean;
  count?: number;
  names?: string[];
  error?: string;
}

export default function NewCampaign() {
  return (
    <Suspense fallback={null}>
      <NewCampaignForm />
    </Suspense>
  );
}

function NewCampaignForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const startFresh = searchParams.get("fresh") === "1";
  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>("FORM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
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
      .then((j) => {
        setIsAdmin(j.role === "admin");
        if (typeof j.userId === "string") setUserId(j.userId);
      })
      .catch(() => {});
  }, []);

  // Draft autosave (localStorage, per user). Keeps the form from being lost on
  // refresh/close. The draft never touches the server — it repopulates the form,
  // which is fully re-sanitized server-side on submit — so it adds no new
  // server attack surface.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftRestoreDone, setDraftRestoreDone] = useState(false); // gates autosave until any existing draft is read
  const [hadSavedDraft, setHadSavedDraft] = useState(false); // whether a draft was actually restored (for the note)
  const draftKey = userId ? `adscopilot:new-campaign-draft:v1:${userId}` : null;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  const [campaignIntent, setCampaignIntent] = useState<CampaignIntent | "">("");
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
  // Per-creative Drive-folder validation results (carousel folder links).
  const [folderChecks, setFolderChecks] = useState<Record<number, FolderCheck>>({});

  async function checkFolder(i: number, url: string) {
    setFolderChecks((m) => ({ ...m, [i]: { checking: true } }));
    try {
      const res = await fetch("/api/campaigns/resolve-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = (await res.json()) as Omit<FolderCheck, "checking">;
      setFolderChecks((m) => ({ ...m, [i]: { checking: false, ...j } }));
    } catch {
      setFolderChecks((m) => ({ ...m, [i]: { checking: false, ok: false, error: "Couldn't check that folder. Try again." } }));
    }
  }

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

  // Resuming an existing not-yet-launched campaign from the Monitor page's
  // Edit button (?edit=<id>). Loads the last-submitted questionnaire from the
  // server (not localStorage — that's a different, browser-local in-progress
  // form) and hydrates the same fields the wizard already tracks. Geography
  // collapses to the manual location rows: the server only stores the
  // resolved targeting, not which coverage-ladder tier produced it.
  // "Start over" (?edit=<id>&fresh=1) reuses the same campaign row — so the
  // relaunch updates it instead of creating a duplicate — but skips
  // re-hydrating the old answers, leaving the form blank to redo from scratch.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${editId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.campaign) {
          setError("Couldn't load that draft — it may have been deleted.");
          setLoadingEdit(false);
          return;
        }
        const c = json.campaign as { clientId?: string | null; questionnaireJson?: string };
        setCampaignId(editId);
        if (c.clientId) setClientId(c.clientId);
        if (startFresh) {
          setLoadingEdit(false);
          setDraftRestoreDone(true);
          return;
        }
        let q: Record<string, unknown> = {};
        try { q = JSON.parse(c.questionnaireJson || "{}"); } catch { /* leave empty */ }
        if (typeof q.campaignIntent === "string" && (CAMPAIGN_INTENTS as string[]).includes(q.campaignIntent)) setCampaignIntent(q.campaignIntent as CampaignIntent);
        if (typeof q.campaignName === "string") setCampaignName(q.campaignName);
        if (typeof q.goal === "string") setGoal(q.goal);
        if (typeof q.landingPageUrl === "string") setLandingPageUrl(q.landingPageUrl);
        if (typeof q.targetAudience === "string") setTargetAudience(q.targetAudience);
        if (typeof q.budgetDollars === "number") setBudgetDollars(q.budgetDollars);
        if (q.budgetType === "DAILY" || q.budgetType === "LIFETIME") setBudgetType(q.budgetType);
        if (typeof q.durationDays === "number") setDurationDays(q.durationDays);
        if (typeof q.abTest === "boolean") setAbTest(q.abTest);
        if (q.abVariable === "CREATIVE" || q.abVariable === "AUDIENCE") setAbVariable(q.abVariable);
        if (typeof q.abNotes === "string") setAbNotes(q.abNotes);
        if (typeof q.campaignDirective === "string") setCampaignDirective(q.campaignDirective);
        const targeting = (q.targeting ?? {}) as Record<string, unknown>;
        if (Array.isArray(targeting.locations) && targeting.locations.length) {
          setHostCity(""); // collapse the coverage ladder — these rows carry the full picture now
          setUseCorridors(false);
          setLocations((targeting.locations as unknown[]).slice(0, 10).map((rw) => {
            const l = (rw ?? {}) as Record<string, unknown>;
            const r = Math.round(Number(l.radiusKm));
            return { name: typeof l.name === "string" ? l.name : "", radiusKm: Number.isFinite(r) ? Math.min(80, Math.max(1, r)) : 15 };
          }));
        }
        if (typeof targeting.ageMin === "number") setAgeMin(String(targeting.ageMin));
        if (typeof targeting.ageMax === "number") setAgeMax(String(targeting.ageMax));
        if (targeting.gender === "MALE" || targeting.gender === "FEMALE" || targeting.gender === "ALL") setGender(targeting.gender);
        if (Array.isArray(q.creatives) && q.creatives.length) {
          setCreatives((q.creatives as unknown[]).slice(0, 10).map((rw, i) => {
            const cr = (rw ?? {}) as Record<string, unknown>;
            const kind = cr.kind === "CAROUSEL" || cr.kind === "VIDEO" ? cr.kind : "IMAGE";
            return {
              kind: kind as CreativeInput["kind"],
              label: `Creative ${String.fromCharCode(65 + i)}`,
              filePaths: Array.isArray(cr.filePaths) ? ((cr.filePaths as unknown[]).filter((x) => typeof x === "string") as string[]) : [""],
              primaryText: typeof cr.primaryText === "string" ? cr.primaryText : "",
              headline: typeof cr.headline === "string" ? cr.headline : "",
              linkUrl: typeof cr.linkUrl === "string" ? cr.linkUrl : "",
            };
          }));
        }
      } catch {
        if (!cancelled) setError("Couldn't load that draft. Try again.");
      }
      if (!cancelled) { setLoadingEdit(false); setDraftRestoreDone(true); }
    })();
    return () => { cancelled = true; };
  }, [editId, startFresh]);

  // Restore a saved draft once, as soon as we know which user this is. Shapes
  // from storage are defensively coerced so a tampered/corrupt draft can only
  // repopulate the form (never crash it), and everything is re-validated
  // server-side on submit.
  useEffect(() => {
    if (!draftKey || draftRestoreDone || editId) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as Record<string, unknown>;
        const s = (k: string, set: (v: string) => void) => { if (typeof d[k] === "string") set(d[k] as string); };
        s("campaignName", setCampaignName); s("goal", setGoal); s("landingPageUrl", setLandingPageUrl);
        s("clientId", setClientId); s("targetAudience", setTargetAudience); s("hostCity", setHostCity);
        s("ageMin", setAgeMin); s("ageMax", setAgeMax); s("abNotes", setAbNotes); s("campaignDirective", setCampaignDirective);
        if (typeof d.campaignIntent === "string" && (CAMPAIGN_INTENTS as string[]).includes(d.campaignIntent)) setCampaignIntent(d.campaignIntent as CampaignIntent);
        if (typeof d.coverageTier === "string") setCoverageTier(d.coverageTier as CoverageTier);
        if (typeof d.useCorridors === "boolean") setUseCorridors(d.useCorridors as boolean);
        if (d.gender === "MALE" || d.gender === "FEMALE" || d.gender === "ALL") setGender(d.gender);
        if (typeof d.budgetDollars === "number") setBudgetDollars(d.budgetDollars as number);
        if (d.budgetType === "DAILY" || d.budgetType === "LIFETIME") setBudgetType(d.budgetType);
        if (typeof d.durationDays === "number") setDurationDays(d.durationDays as number);
        if (typeof d.abTest === "boolean") setAbTest(d.abTest as boolean);
        if (d.abVariable === "CREATIVE" || d.abVariable === "AUDIENCE") setAbVariable(d.abVariable);
        if (Array.isArray(d.locations)) {
          setLocations((d.locations as unknown[]).slice(0, 10).map((rw) => {
            const l = (rw ?? {}) as Record<string, unknown>;
            const r = Math.round(Number(l.radiusKm));
            return { name: typeof l.name === "string" ? l.name : "", radiusKm: Number.isFinite(r) ? Math.min(80, Math.max(1, r)) : 15 };
          }));
        }
        if (Array.isArray(d.creatives)) {
          setCreatives((d.creatives as unknown[]).slice(0, 10).map((rw, i) => {
            const c = (rw ?? {}) as Record<string, unknown>;
            const kind = c.kind === "CAROUSEL" || c.kind === "VIDEO" ? c.kind : "IMAGE";
            return {
              kind: kind as CreativeInput["kind"],
              label: `Creative ${String.fromCharCode(65 + i)}`, // auto-assigned by position, not user-set
              filePaths: Array.isArray(c.filePaths) ? ((c.filePaths as unknown[]).filter((x) => typeof x === "string") as string[]) : [""],
              primaryText: typeof c.primaryText === "string" ? c.primaryText : "",
              headline: typeof c.headline === "string" ? c.headline : "",
              linkUrl: typeof c.linkUrl === "string" ? c.linkUrl : "",
            };
          }));
        }
        setHadSavedDraft(true);
      }
    } catch {
      /* corrupt draft — ignore and start fresh */
    }
    setDraftRestoreDone(true);
  }, [draftKey, draftRestoreDone]);

  // Autosave the form (debounced) once any existing draft has been read.
  useEffect(() => {
    if (!draftKey || !draftRestoreDone || phase !== "FORM") return;
    const snapshot = { campaignIntent, campaignName, goal, landingPageUrl, clientId, targetAudience, hostCity, coverageTier, useCorridors, locations, ageMin, ageMax, gender, budgetDollars, budgetType, durationDays, creatives, abTest, abVariable, abNotes, campaignDirective };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(snapshot)); setDraftSavedAt(Date.now()); } catch { /* quota — ignore */ }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [draftKey, draftRestoreDone, phase, campaignIntent, campaignName, goal, landingPageUrl, clientId, targetAudience, hostCity, coverageTier, useCorridors, locations, ageMin, ageMax, gender, budgetDollars, budgetType, durationDays, creatives, abTest, abVariable, abNotes, campaignDirective]);

  function clearDraft() {
    if (draftKey) {
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    }
    setDraftSavedAt(null);
    setHadSavedDraft(false);
  }

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

  // Labels are auto-assigned by position (Creative A, B, C…) and never user-set —
  // they're just stable, unique identifiers the copilot/launcher use to match
  // ads to creatives. Relabel on every add/remove so display and stored value
  // always agree and stay unique.
  function relabel(cs: CreativeInput[]): CreativeInput[] {
    return cs.map((c, i) => ({ ...c, label: `Creative ${String.fromCharCode(65 + i)}` }));
  }

  function addCreative() {
    setCreatives((cs) =>
      cs.length < 10
        ? relabel([...cs, { kind: "IMAGE", label: "", filePaths: [""], primaryText: "", headline: "", linkUrl: "" }])
        : cs,
    );
  }

  function removeCreative(i: number) {
    setCreatives((cs) => (cs.length > 1 ? relabel(cs.filter((_, j) => j !== i)) : cs));
  }

  // Resolve the coverage ladder → concrete Meta locations + strategy hints.
  const coverage = useMemo(
    () => resolveCoverage(hostCity, coverageTier, useCorridors),
    [hostCity, coverageTier, useCorridors],
  );

  // Live validity of the (optional) landing URL — empty is fine, otherwise it
  // must be a parseable https URL, matching the server's safeUrl() boundary.
  const landingUrlValid = useMemo(() => {
    const v = landingPageUrl.trim();
    if (!v) return true;
    try { return new URL(v).protocol === "https:"; } catch { return false; }
  }, [landingPageUrl]);

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
        campaignIntent: campaignIntent || undefined,
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
    setLaunchError(null);
    try {
      const res = await fetch(`/api/campaigns/${cid}/preflight`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error || "Preflight check could not run. Try again.");
      } else {
        setPreflight(json as PreflightResult);
      }
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
    setLaunchError(null);
    setPhase("LAUNCHING");
    const res = await fetch(`/api/campaigns/${campaignId}/launch`, { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setLaunchError(json.error);
      if (json.preflight) setPreflight(json.preflight as PreflightResult);
      setPhase("RECEIPT");
      return;
    }
    clearDraft(); // campaign launched — the draft is no longer needed
    router.push(`/campaigns/${campaignId}`);
  }

  const steps = ["Basics", "Audience", "Budget & Schedule", "Creatives & A/B"];

  if (loadingEdit) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">New Campaign</h1>
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line-standard)] bg-[var(--surface-1)] p-4 text-sm text-[var(--ink-secondary)]">
          <Spinner /> Loading your draft…
        </div>
      </div>
    );
  }

  return (
    <div className={`mx-auto ${phase === "FORM" && step === 4 ? "max-w-4xl" : "max-w-2xl"} space-y-6`}>
      <h1 className="text-2xl font-semibold">New Campaign</h1>

      {editId && !error && (
        <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning-wash)] p-3 text-sm text-[var(--ink-primary)]">
          {startFresh
            ? "↺ Starting over on this campaign — your previous answers were cleared, but relaunching will update the same campaign."
            : "↩ Continuing your saved draft — pick up where you left off."}
        </div>
      )}

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

          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--ink-muted)]">
              {hadSavedDraft && <span className="text-[var(--success)]">↩ Restored your saved draft. </span>}
              {draftSavedAt
                ? "✓ Progress saved automatically — safe to refresh or come back later."
                : "Your progress saves automatically as you go."}
            </span>
            {(draftSavedAt || hadSavedDraft) && (
              <button
                type="button"
                onClick={() => { clearDraft(); window.location.reload(); }}
                className="shrink-0 rounded-lg border border-[var(--line-standard)] px-3 py-1.5 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-secondary)] active:scale-[0.98]"
              >
                Start over
              </button>
            )}
          </div>

          <div className="space-y-4 rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-1)] p-6">
            {step === 1 && (
              <>
                {/* Strategic intent, captured first — it coaches every later
                    choice, above all the rotation-vs-A/B decision on Step 4. */}
                <div>
                  <label className={labelCls}>What&rsquo;s this campaign for?</label>
                  <p className="mb-2 text-xs text-[var(--ink-muted)]">
                    Pick the goal that fits best — we&rsquo;ll tailor the whole setup, and how the AI builds your ads, around it.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CAMPAIGN_INTENTS.map((key) => {
                      const def = INTENT_DEFS[key];
                      const active = campaignIntent === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setCampaignIntent(key); setGoal(def.suggestedGoal); }}
                          className="flex items-start gap-3 rounded-xl border p-3 text-left transition hover:brightness-110 active:scale-[0.99]"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--line-subtle)",
                            background: active ? "var(--accent-wash)" : "var(--surface-1)",
                          }}
                        >
                          <span className="text-xl leading-none">{def.icon}</span>
                          <span>
                            <span className="block text-sm font-semibold text-[var(--ink-primary)]">{def.label}</span>
                            <span className="block text-xs text-[var(--ink-muted)]">{def.tagline}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {campaignIntent && (
                    <div className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-secondary)]">
                      <b className="text-[var(--ink-primary)]">Why we recommend this approach:</b> {INTENT_DEFS[campaignIntent].whyRecommend}
                    </div>
                  )}
                </div>

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
                  <input
                    className={inputCls}
                    style={landingPageUrl.trim() ? { borderColor: landingUrlValid ? "var(--success)" : "var(--warning)" } : undefined}
                    value={landingPageUrl}
                    onChange={(e) => setLandingPageUrl(e.target.value)}
                    placeholder="https://yourvenue.com/book"
                    inputMode="url"
                  />
                  {landingPageUrl.trim() && (
                    <p className={`mt-1 text-xs ${landingUrlValid ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
                      {landingUrlValid
                        ? "✓ Valid link — this is where your ad clicks will go."
                        : "⚠️ That doesn't look like a full web address. Include https:// (e.g. https://yourvenue.com/book)."}
                    </p>
                  )}
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
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Type any city — the suggestions are common Ontario locations, but you can enter any place your event or studio is.
                  </p>

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
                {/* Retroactive intent switch — let the user pivot their goal here
                    without going back to the Basics step. */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                  <label htmlFor="intent-switch" className="text-xs font-medium text-[var(--ink-secondary)]">
                    Campaign goal — change your mind? Pivot anytime:
                  </label>
                  <select
                    id="intent-switch"
                    className="rounded-lg border border-[var(--line-standard)] bg-[var(--surface-1)] px-2 py-1 text-xs"
                    value={campaignIntent}
                    onChange={(e) => {
                      const v = e.target.value as CampaignIntent | "";
                      setCampaignIntent(v);
                      if (v) setGoal(INTENT_DEFS[v].suggestedGoal);
                    }}
                  >
                    <option value="">— pick a goal —</option>
                    {CAMPAIGN_INTENTS.map((k) => (
                      <option key={k} value={k}>{INTENT_DEFS[k].icon} {INTENT_DEFS[k].label}</option>
                    ))}
                  </select>
                </div>

                {/* Intent-driven coaching: recommend rotation vs A/B for the
                    owner's stated goal, and offer a one-click fix on conflict. */}
                {campaignIntent && (() => {
                  const def = INTENT_DEFS[campaignIntent];
                  const nudge = intentApproachNudge(campaignIntent, abTest);
                  return (
                    <div className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--accent-wash)" }}>
                      <p className="text-sm font-semibold text-[var(--ink-primary)]">
                        {def.icon} For &ldquo;{def.label}&rdquo;, we recommend{" "}
                        {def.recommend === "AB" ? "a formal A/B split test" : "running 2–3 rotating ads — not a formal test"}.
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-secondary)]">{def.creativeGuidance}</p>
                      {nudge && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-1)] px-3 py-2">
                          <span className="text-xs text-[var(--warning)]">⚠️ {nudge.message}</span>
                          <button
                            type="button"
                            onClick={() => setAbTest(nudge.kind === "suggest-ab")}
                            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-[var(--accent-strong)] active:scale-[0.98]"
                          >
                            {nudge.kind === "suggest-ab" ? "Turn on A/B for me" : "Switch to rotation"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* First-timer explainer, tucked behind progressive disclosure so
                    it never walls off the task for repeat users. */}
                <Disclosure summary="New to Meta ads? How campaigns, ad sets & ads fit together">
                  <p>
                    Think of your campaign like promoting an event — Meta stacks it in three layers. The AI builds the first two
                    from what you&rsquo;ve already told us; <b>you build the third here</b>:
                  </p>
                  <ul className="space-y-1">
                    <li><b className="text-[var(--ink-primary)]">Campaign</b> — your goal &amp; budget <span className="text-[var(--ink-muted)]">(earlier steps)</span></li>
                    <li><b className="text-[var(--ink-primary)]">Ad set</b> — <b>who</b> sees it &amp; <b>where</b> the money goes <span className="text-[var(--ink-muted)]">(AI-built from your Step&nbsp;2 audience)</span></li>
                    <li><b className="text-[var(--accent)]">Ads — this step</b> — <b>what people see</b>: your photo/video and words. Each creative below becomes one ad.</li>
                  </ul>
                  <p className="text-[var(--ink-muted)]">
                    <b>Short version:</b> add one strong ad and launch. Add more, or split-test, only when you want to <i>learn</i> what works.
                  </p>
                </Disclosure>

                <div className="rounded-lg bg-[var(--surface-2)] p-4">
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={abTest} onChange={(e) => setAbTest(e.target.checked)} className="h-4 w-4" />
                    <span className="font-medium">Run an A/B split test at launch</span>
                    <span className="text-xs text-[var(--ink-muted)]">— optional</span>
                  </label>
                  {!abTest && (
                    <p className="mt-1 pl-7 text-xs text-[var(--ink-muted)]">
                      Off = one campaign; your ads rotate and Meta favours the winner. Turn on to formally test <b>two</b> variants head-to-head.
                    </p>
                  )}
                  {abTest && (
                    <div className="mt-3">
                      <label className={labelCls}>What do you want to test?</label>
                      <select className={inputCls} value={abVariable} onChange={(e) => setAbVariable(e.target.value as "CREATIVE" | "AUDIENCE")}>
                        <option value="CREATIVE">The ad itself — same audience, two different ads</option>
                        <option value="AUDIENCE">The audience — same ad, two different ad sets</option>
                      </select>
                      <div className="mt-2 rounded-lg bg-[var(--surface-1)] px-3 py-2 text-xs text-[var(--ink-secondary)]">
                        {abVariable === "CREATIVE" ? (
                          <>
                            <b className="text-[var(--accent)]">Testing the ad (assets):</b> Meta shows the <i>same</i> people two different ads
                            and finds the stronger one. Answers <i>&ldquo;which creative wins?&rdquo;</i> — e.g. a video venue tour vs a photo
                            with a starting price. <b>Add exactly two creatives below</b> (any beyond that just run as extra rotating ads, not test cells).
                          </>
                        ) : (
                          <>
                            <b className="text-[var(--human)]">Testing the audience (ad sets):</b> Meta shows the <i>same</i> ad to two
                            different audiences and finds who responds best. Answers <i>&ldquo;who should I target?&rdquo;</i> — e.g. couples 25–34 vs
                            35–44. The AI builds the two ad sets from your Step 2 audience; you just need one strong ad.
                          </>
                        )}
                      </div>
                      {abVariable === "CREATIVE" && creatives.length < 2 && (
                        <p className="mt-2 rounded-lg bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">
                          ⚠️ Only one creative added. A creative split needs 2+. It will launch as a single campaign unless you add another creative below — or turn A/B off.
                        </p>
                      )}
                      {abVariable === "CREATIVE" && new Set(creatives.map((c) => c.kind)).size > 1 && (
                        <p className="mt-2 rounded-lg bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">
                          ⚠️ Your creatives mix formats ({[...new Set(creatives.map((c) => c.kind))].join(", ").toLowerCase()}). A clean A/B
                          test compares like-for-like — a video vs a carousel confounds the result. Use one format per split, or turn A/B off to just run them all.
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

                {/* Focal point of the step: the actual ads. A heading + a single
                    helper line anchors it above the guidance that precedes it. */}
                <div className="flex items-baseline justify-between gap-3 pt-2">
                  <h3 className="text-base font-semibold text-[var(--ink-primary)]">Your ads</h3>
                  <span className="text-xs text-[var(--ink-muted)]">{creatives.length} of 10</span>
                </div>
                <p className="-mt-3 text-xs text-[var(--ink-muted)]">
                  Each creative becomes its own ad. One is enough to launch — add more to let Meta rotate them and favour the winner.
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                {creatives.map((c, i) => {
                  const ks = KIND_STYLE[c.kind];
                  return (
                  <div key={i} className="space-y-3 rounded-lg border p-4" style={{ borderColor: ks.border, background: ks.wash }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: ks.accent, color: "#1a0f08" }}>{ks.label}</span>
                        <span className="text-sm font-semibold text-[var(--ink-primary)]">Creative {String.fromCharCode(65 + i)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select className={`${inputCls} max-w-32`} value={c.kind} onChange={(e) => updateCreative(i, { kind: e.target.value as CreativeInput["kind"] })}>
                          <option value="IMAGE">Single image</option>
                          <option value="CAROUSEL">Carousel</option>
                          <option value="VIDEO">Video</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeCreative(i)}
                          disabled={creatives.length === 1}
                          className="shrink-0 rounded-lg border border-[var(--line-standard)] px-2 py-2 text-xs text-[var(--ink-tertiary)] hover:bg-[var(--surface-2)] disabled:opacity-30"
                          aria-label="Remove creative"
                          title={creatives.length === 1 ? "At least one creative is required" : "Remove this creative"}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {/* A/B cell labeling: the plan only measures two cells (A/B).
                        Make it explicit which cards are the test and which are extras. */}
                    {abTest && abVariable === "CREATIVE" && (
                      i < 2 ? (
                        <span className="inline-block rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-black">
                          Test variant {i === 0 ? "A" : "B"}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-xs font-medium text-[var(--ink-tertiary)]">
                          Extra rotating ad — not a measured test cell
                        </span>
                      )
                    )}

                    {/* Context helper for the chosen format — one quiet line (no
                        nested card); the concrete tip is available on hover. */}
                    <p className="text-xs text-[var(--ink-muted)]" title={KIND_GUIDE[c.kind].tip}>
                      {KIND_GUIDE[c.kind].bestFor} <span className="text-[var(--ink-tertiary)]">· {KIND_GUIDE[c.kind].effort}</span>
                    </p>

                    <div>
                      <label className={labelCls}>
                        {c.kind === "CAROUSEL"
                          ? "Image links (one per line, 2–10) — or one shared Drive folder link"
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
                        Set sharing to <b>&ldquo;Anyone with the link&rdquo;</b> so Meta can fetch at launch — we don&rsquo;t copy or store your media.
                        {c.kind === "CAROUSEL" && <> For a carousel you can also paste <b>one shared folder link</b> and we&rsquo;ll pull its images.</>}
                      </p>
                      {c.kind === "CAROUSEL" && (() => {
                        const lines = c.filePaths.map((p) => p.trim()).filter(Boolean);
                        const folderLink = lines.length === 1 && isDriveFolderLink(lines[0]) ? lines[0] : null;
                        if (folderLink) {
                          const fc = folderChecks[i];
                          return (
                            <div className="mt-2 space-y-1">
                              <button
                                type="button"
                                onClick={() => checkFolder(i, folderLink)}
                                disabled={fc?.checking}
                                className="rounded-lg border border-[var(--line-standard)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition hover:bg-[var(--surface-2)] active:scale-[0.98] disabled:opacity-50"
                              >
                                {fc?.checking ? "Checking folder…" : "Check folder contents"}
                              </button>
                              {fc && !fc.checking && (
                                <p className={`text-xs ${fc.ok ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
                                  {fc.ok ? `✓ Found ${fc.count} image${fc.count === 1 ? "" : "s"} — ready for a carousel.` : `⚠️ ${fc.error}`}
                                </p>
                              )}
                            </div>
                          );
                        }
                        const n = lines.length;
                        const ok = n >= 2 && n <= 10;
                        return (
                          <p className={`mt-1 text-xs ${ok ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
                            {ok ? "✓" : "⚠️"} {n} image link{n === 1 ? "" : "s"} — a carousel needs <b>2–10</b> (or one shared folder link).
                          </p>
                        );
                      })()}
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
                        Lead with your hook in the <b>first ~125 characters</b> (before Meta&rsquo;s &ldquo;See more&rdquo;). Cover your offer,
                        what&rsquo;s different, and a clear call to action — a few short sentences beat a wall of text.
                      </p>
                    </div>
                  </div>
                  );
                })}
                </div>
                {creatives.length < 10 ? (
                  <button
                    type="button"
                    onClick={addCreative}
                    className="rounded-lg border border-[var(--line-standard)] px-3 py-1.5 text-sm font-medium text-[var(--success)] transition hover:bg-[var(--surface-2)] hover:brightness-110 active:scale-[0.98]"
                  >
                    + Add another creative
                  </button>
                ) : (
                  <p className="text-xs text-[var(--ink-muted)]">Maximum of 10 creatives reached.</p>
                )}

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
                  clientId={clientId}
                />

                {/* Technical */}
                <PreflightCategory
                  title="Technical"
                  checks={preflight.checks.filter((c) => c.category === "technical")}
                  onJump={jumpTo}
                  clientId={clientId}
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
          {launchError && (
            <div className="mt-3 rounded-xl border border-[var(--line-standard)] bg-[var(--danger-wash)] p-4 text-sm text-[var(--danger)]">{launchError}</div>
          )}
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

/**
 * Progressive-disclosure block. Secondary guidance lives here so the default
 * view stays scannable instead of stacking paragraphs into a wall. Native
 * <details> = keyboard- and screen-reader-accessible for free; the summary row
 * carries the project's hover/press feedback and a chevron that flips on open.
 */
function Disclosure({ summary, defaultOpen = false, children }: { summary: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-lg bg-[var(--surface-2)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--ink-secondary)] transition hover:text-[var(--ink-primary)] active:scale-[0.99] [&::-webkit-details-marker]:hidden">
        <span className="text-[var(--ink-tertiary)] transition-transform group-open:rotate-90" aria-hidden>›</span>
        {summary}
      </summary>
      <div className="space-y-2 px-3 pb-3 pl-7 text-xs leading-relaxed text-[var(--ink-secondary)]">{children}</div>
    </details>
  );
}

interface PfCheck { item: string; ok: boolean; severity: "error" | "warning"; detail: string; jumpStep?: 1 | 2 | 3 | 4 }

/** A titled group of pre-flight checks with a jump-to-fix button on failures. */
function PreflightCategory({ title, checks, onJump, clientId }: { title: string; checks: PfCheck[]; onJump: (s: 1 | 2 | 3 | 4) => void; clientId?: string }) {
  if (checks.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">{title}</h4>
      <div className="space-y-1.5 text-sm">
        {checks.map((c, i) => {
          const resolution = !c.ok && !c.jumpStep ? getCheckResolution(c.item) : undefined;
          const actionHref = resolution?.actionHref?.(clientId) ?? null;
          return (
            <div key={i}>
              <div className="flex items-start gap-2">
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
              {resolution && (
                <div className="ml-6 mt-1">
                  <Disclosure summary="How to fix this">
                    <p>{resolution.instructions}</p>
                    {resolution.actionLabel && actionHref && (
                      <a
                        href={actionHref}
                        className="mt-1.5 inline-block rounded border border-[var(--line-standard)] px-2 py-0.5 text-xs text-[var(--info)] hover:bg-[var(--surface-1)]"
                      >
                        {resolution.actionLabel} →
                      </a>
                    )}
                  </Disclosure>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
