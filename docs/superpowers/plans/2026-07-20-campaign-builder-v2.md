# Campaign Builder v2 — Client Feedback Implementation & Handoff

> **RESUME HERE.** Branch **`feat/campaign-builder-v2`** (off `main`). Slice 1 is committed (`f586c4e`) and tsc-clean. This doc is the source of truth for what's done vs pending.

**Goal:** Make the New Campaign flow (`app/new/page.tsx`) give users far more guided control over Meta targeting than Meta Ads Manager, and let them steer the AI per-campaign — from client feedback.

**Decisions locked (from the user):**
- **No Google Cloud/Maps.** The app sanitizes/validates/formats location input for Meta itself (`lib/targeting.ts`). Optional future: validate exact city keys via Meta's own geo catalog (`/search?type=adgeolocation`) — free, uses the client's Meta token.
- **Drive media:** at launch, our server pulls the file from the Drive share link and streams it to **Meta** (`/act_/advideos` `file_url` for video; `picture` URL directly for images). Meta hosts it after; **we store nothing** — only the link/`video_id`.
- **Build the audience gap-checker** (AI "check my targeting").
- **Add optional age + gender** controls; interests stay AI-inferred behind the existing catalog-validation wall in `lib/copilot.ts`.

## Key facts (don't re-derive)
- Audience/geo/directives ARE read by the Copilot (`lib/copilot.ts` `runCopilot` → Llama). It outputs strict Meta targeting; there's an anti-hallucination wall for audience/interest IDs (not geo).
- Daily optimizer runs **09:00 UTC** (`vercel.json` cron `0 9 * * *`).
- Manager Directive = `BusinessProfile.directive`/`directiveAt` (client-level). NEW per-campaign `Campaign.directive`/`directiveAt`/`abNotes` added this session.
- Meta bridge: `lib/meta.ts` (`metaFetch` = URL-encoded form POST; `createAdCreative`, `searchInterests` pattern to mirror for video/geo). Launcher: `lib/launcher.ts` (`creativePayload` — video uses `video_data.video_id`, image uses `link_data.picture` = a URL).
- `lib/targeting.ts` is written and tsc-clean (validate/format locations + age/gender) but **not yet wired** into the form/route/copilot.

## Slice 1 — DONE this session (committed f586c4e)
- [x] Duration slider → sanitized number field.
- [x] Audience + location guidance microcopy (how to answer; AI reads it).
- [x] A/B "what's different / what to watch" notes → copilot.
- [x] Per-campaign directive field → copilot + persisted (`Campaign.directive/directiveAt`).
- [x] Daily-check transparency (9am UTC + local) on Step 4 + receipt.
- [x] Schema: additive nullable `Campaign.abNotes/directive/directiveAt`.
- [x] `lib/targeting.ts` prepped.

## Slice 2 — DONE (commits 6b51ba4, d924228, cb35102, 05d8f0c; static red-team GO)
- [x] Structured location rows + optional age/gender; `lib/targeting.ts` wired (validate/format; user age/gender overrides the model).
- [x] Editable directive/abNotes after launch — `PATCH /api/campaigns/[id]` + `DirectiveEditor` on the campaign page (shows 9am-UTC check time).
- [x] Optimizer weighs the campaign directive + A/B intent daily.
- [x] Audience gap-checker — `POST /api/campaigns/check-targeting` + "Check my targeting" button (Cloudflare Workers AI / Llama-70B).
- [x] Google Drive media — `lib/drive.ts` normalize + `meta.uploadVideoFromUrl` (file_url→video_id) + launcher wiring; images use the URL directly. No bytes stored.

**Remaining follow-ups (optional):** very-large-video chunked upload (current path is Meta `file_url`); Meta geo-catalog validation of exact city keys; interests as explicit input. Ship the additive columns (`db:push` staging→prod, prod via `!`) before merging — see Ship steps below.

## (original Slice 2 task notes — kept for reference)

- [ ] **Structured location UI.** Replace the free-text "Where should this campaign target?" input with rows of `{ name, radiusKm }` (add/remove; radius 1–80). Store `locations[]` in form state; on submit send `targeting: { locations, ageMin, ageMax, gender }`. Adapt the profile prefill (currently sets `geography`) to seed `locations[0].name`. Keep sending a `geography` summary string for backward-compat (derive from locations).
- [ ] **Age + gender controls** in Step 2 (optional; blank = AI decides).
- [ ] **Wire `lib/targeting.ts`:** in `app/api/campaigns/route.ts` call `validateTargeting(input.targeting)`; in `lib/copilot.ts` add `formatTargetingForModel(...)` to the prompt and let the plan honor explicit age/gender (`metaGenders`). Add `targeting` to `QuestionnaireInput`.
- [ ] **Editable after launch.** Campaign detail page (`app/campaigns/[id]/page.tsx`) — add an editor for `directive` + `abNotes` and show the 9am-UTC check time. New `PATCH /api/campaigns/[id]` (owner/admin via `canAccessCampaign`) that sanitizes (`cleanText`) and updates `directive`/`directiveAt`/`abNotes`. (Check `app/api/campaigns/[id]/route.ts` for existing handlers first.)
- [ ] **Optimizer wiring.** `lib/optimizer.ts` + `lib/research.ts` (`getGroundTruth`/directive block) — include the campaign directive (and abNotes for A/B campaigns) alongside the Manager Directive when making daily decisions. Mirror the existing `## MANAGER'S CURRENT DIRECTIVE` block with a `## THIS CAMPAIGN'S DIRECTIVE`.
- [ ] **Audience gap-checker.** New `POST /api/campaigns/check-targeting` (rate-limited via `aiRateLimited`) → `runLlamaJson` prompt that takes audience + structured targeting and returns `{ gaps: string[], suggestions: string[], readyScore }`. Add a "Check my targeting" button in Step 2 that renders the feedback. Keep it advisory (never blocks).
- [ ] **Drive media.** (a) `lib/drive.ts`: `normalizeDriveUrl(share)` → extract file ID, return direct URL, validate host ∈ {drive.google.com, docs.google.com}, https only (reuse urlSafety ideas). (b) `lib/meta.ts`: `uploadVideoFromUrl(creds, fileUrl)` → POST `act_/advideos` with `file_url`, return `video_id`; handle Meta's async processing. (c) `lib/launcher.ts`: for VIDEO creatives, if source is a Drive/URL, upload → use returned `video_id`; for IMAGE, pass the normalized URL as `picture`. (d) Form Step 4: relabel "file path" → "Google Drive share link (or public URL)" with guidance. Note limitation: very large videos may need chunked upload (follow-up).

## Ship steps (safe path to prod)
1. `db:push` the additive columns to **staging** (agent can if `DATABASE_URL`=staging ref `lprydieusipocvsikkqb`), test on the preview.
2. Run the red-team static pass: `npm run redteam:full` (GO/NO-GO).
3. **User** runs `db:push` on **prod** via `!` (additive nullable = safe; classifier-blocked for the agent). Prod DB ref `ovdpfhexljhotzhrfhrg`.
4. Open PR → merge (the approval gate) → Vercel deploys prod. Expand-contract: columns added before code that uses them = no downtime.

## Also pending from before (separate branches)
- `feat/deploy-pipeline` — Phase 1 pipeline (see its own plan; Task 8 verify next).
- Phase 2 Prisma Migrate adoption (would replace the manual db:push above).
