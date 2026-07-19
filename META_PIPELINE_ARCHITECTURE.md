# META ADS AI AGENT PIPELINE: SYSTEM ARCHITECTURE & BUILD INSTRUCTIONS

## 1. System Objective
Build an autonomous, multi-agent Meta Ads pipeline that ingests a `business_profile.md` document and handles campaign creation, A/B testing, deployment, real-time monitoring, and dynamic optimization via the Meta Graph API (v20+). 

The system must not operate with blind autonomy. It must utilize a "Human-in-the-Loop" (HITL) approval dashboard and enforce strict financial guardrails.

## 2. The Multi-Agent Workflow (CrewAI / LangChain architecture)
Structure the backend logic using a multi-agent framework. Divide the workload into the following agent roles:
*   **Strategist Agent:** Parses `business_profile.md`. Defines audience segmentation, attribution windows (Strictly use 7-day click, 1-day view for consistency), and budgets.
*   **Creative Agent:** Generates primary text, headlines, and maps media assets to ad variants.
*   **Media Buyer Agent:** Executes the Graph API calls. Validates budget distribution and ensures no missing parameters.
*   **Analyst Agent:** Polls the `/insights` endpoint daily. Calculates ROAS, CPA, and detects anomalies (e.g., sudden CPM spikes).

## 3. The Execution Loop & Dashboard Interface
The system must follow this exact loop:

### Step 1: Ingestion & Campaign Architecture
*   Read the Markdown profile.
*   Generate a structured JSON payload representing the campaign.
*   **Constraint:** Enforce Campaign Budget Optimization (CBO). Limit Ad Sets to a maximum of 3 per campaign to concentrate Meta's internal learning signals.

### Step 2: The Staging Dashboard (Human Approval)
*   Do not push to Meta immediately.
*   Render a CLI or Web UI summarizing: Campaign Structure, Targeting, Ad Creatives, and Daily Spend Limits.
*   Require user boolean approval (`Approve` / `Reject` / `Modify`).

### Step 3: API Deployment
*   Upon approval, sequence the Meta Marketing API POST requests:
    1. `POST /{ad_account_id}/campaigns`
    2. `POST /{ad_account_id}/adsets`
    3. `POST /{ad_account_id}/adcreatives`
    4. `POST /{ad_account_id}/ads`

### Step 4: Monitoring & "Hibernate-and-Wake"
*   Implement a cron or background worker that wakes up daily to query the `/insights` API.
*   Push metrics (Spend, CPA, ROAS, CTR, Frequency) to the live dashboard.

### Step 5: Recommendation Engine & Execution
*   The Analyst Agent must generate discrete, actionable recommendations (e.g., "Pause Ad ID 12345: CPA exceeds $50 threshold. Reallocate to Ad ID 67890").
*   Present these options on the dashboard.
*   Upon user click/approval, the Media Buyer Agent executes the API `POST` to update the ad status or budget.

## 4. Hardcoded Guardrails (CRITICAL)
Claude, you must implement these safety checks in the code before any API keys are loaded. If a payload violates these, the system must throw an exception and refuse to execute:
*   **Global Spend Cap:** Hardcode a maximum daily spend limit that cannot be overridden by AI generation.
*   **CPA / ROAS Floors:** Define absolute minimums. If a campaign drops below the floor for 48 hours, the agent must auto-pause it, requiring no human approval for the kill switch.
*   **Zero-Scraping Rule:** Do not use browser automation (Puppeteer/Selenium) to scrape the Meta dashboard. Strictly use the official Meta Graph API.

## 5. The Phased Autonomy Rollout (The Superscale Protocol)

### Phase 1 (First 72 Hours): Read-Only / Advisory
- The agent builds campaigns, user approves via dashboard
- It monitors live data and surfaces recommendations
- User manually approves all actions
- **Safety Posture:** Completely non-destructive

### Phase 2: Budget Pacing Autonomy
- Agent is allowed to shift budgets inside existing CBO campaigns
- Cannot launch new creatives or pause ads without approval
- Operates within pre-defined budget corridors
- **Safety Posture:** Constrained financial autonomy

### Phase 3: Full Loop Autonomy
- Agent detects creative fatigue proactively
- Generates new ad variants autonomously
- Pushes to API and prunes underperformers
- Can pause/pause ads within guardrails
- **Safety Posture:** Full operational autonomy with financial guardrails

## 6. 2026 Platform Reality Check (Research-Validated)

### Confirmed Industry Standards (High Confidence)

**1. Unified Advantage+ Architecture (Effective May 19, 2026)**
- Meta consolidated Advantage Shopping Campaigns (ASC) and Advantage App Campaigns (AAC) into a single Advantage+ structure
- API v24.0 (Oct 8, 2025): Blocks creation of new ASC/AAC
- API v25.0 (Feb 18, 2026): Enforces breaking changes
- **DEADLINE:** May 19, 2026 full restrictions (as of July 16, 2026, this deadline has passed—legacy APIs are now non-functional)
- All campaigns now use identical three-lever automation model
- **Source:** Meta official developer documentation (developers.facebook.com/docs/marketing-api/changelog)

**2. Three-Component Automation Trigger (Required for Advantage+)**
To achieve full Advantage+ automation, campaigns must have ALL THREE configured:
1. **Campaign-level budget** with CBO enabled and supported bid strategies (e.g., COST_CAP, ROAS_CAP)
2. **Advantage+ Audience** via `targeting_automation` parameter (allows Meta's ML to expand audience)
3. **Placement** with no targeting exclusions (Meta optimizes across all available placements)

When all three are present, Meta automatically transitions the campaign to full Advantage+ state.
- **Source:** Meta official developer documentation + ppc.land validation

**3. Creative Enhancement Suite (Automated Transformations)**
Meta now offers three automated creative transformation features via `degrees_of_freedom_spec.creative_features_spec` parameter:
- **`image_animation`:** Automatically transforms static images into short, subtly animated videos
- **`video_uncrop`:** Expands video framing to fill ad placements
- **`video_filtering`:** Applies visual filters and effects to video creatives
- **Control:** Advertisers can opt in/out per creative basis
- **Source:** Meta official OCC-2026 documentation (dated June 28, 2026)

**4. API Access Tier Modernization (Effective May 4, 2026)**
- **Old threshold:** 1,500 calls in rolling 15-day window for full access
- **New threshold:** 500 calls in rolling 15-day window (effective May 4, 2026)
- **Error rate calculation:** Shifted to rolling window of last 500 calls (vs. fixed time periods)
- **Impact:** Agent-driven real-time optimization is now viable even for lean accounts
- **Source:** Meta official developers.meta.com blog + corroboration from Get-Ryze, AdLibrary, AdAmigo

**5. Human-in-the-Loop Guardrails (Mandatory for Production)**
Research validates that production automation REQUIRES:
- **Mandatory approval gates** for high-cost actions (>$100 refunds, budget multipliers >1.5x)
- **Hard iteration limits:** 10–50 steps per optimization cycle (prevent runaway loops)
- **Stall detection:** Abort if N consecutive identical API calls detected (standard practice: LangChain, CrewAI, LangGraph)
- **Regulatory compliance:** EU AI Act Article 14 (enforceable Aug 2, 2026) mandates human oversight
- **Real-world validation:** March 2026 AWS incident—production AI wiped database due to missing approval gates
- **Workplace validation:** 70% of workplace AI users report AI is reliable only when paired with human review (Gartner, Jan 2024)
- **Source:** LangChain HumanInTheLoopMiddleware, CrewAI 0.60.0+, EU AI Act Article 14

---

## 7. Critical Caveats & Refuted Claims

### ⚠️ ROAS Performance Claims: Unanimously Refuted
**All specific ROAS improvement claims were rejected (0-3 verification votes):**
- ❌ "8–15% ROAS improvement" over previous daily optimization
- ❌ "3.2x → 3.6x (+12%) improvement" for e-commerce
- ❌ "16% ROAS improvement" (3.14 vs 2.70) for Advantage+ Sales
- ❌ "22% higher ROAS" vs. manual campaigns

**Why:** These are **unverified vendor marketing claims**. No authoritative benchmarks exist for 2026 Advantage+ automation across verticals. Performance varies drastically by:
- Industry vertical (e-commerce ≠ lead gen ≠ app installs)
- Budget scale ($100/day ≠ $5,000/day)
- Creative quality (dominant factor: 50–70% of campaign performance)
- Account history and audience sophistication

**Implication:** Do NOT promise users ROAS improvements. Promise optimization *potential*, not guaranteed returns.

### ⚠️ Agent Framework Benchmarks: Unverified
**All framework-specific cost and performance claims were rejected (0-3 votes):**
- ❌ CrewAI costs "$0.10–$0.20 per run" for three-agent sequential teams
- ❌ "18% token overhead" for CrewAI vs. LangGraph
- ❌ LangGraph "87% task success rate"
- ❌ LangGraph "47M monthly downloads, most widely adopted"
- ❌ Strands offers "four distinct built-in multi-agent patterns"

**Why:** No authoritative cost or performance data exists for these frameworks in the Meta advertising domain. Vendor blogs lack independent verification.

**Implication:** Choose frameworks based on **local deployment requirements**, not vendor claims. CrewAI and LangGraph both work; pick what your infrastructure supports.

### ⚠️ Approval Workflow Specifics: Guidance Gap
While human approval is **mandatory**, research found **minimal guidance** on:
- Optimal integration timing (before API call? after? both?)
- Escalation rules (which actions require manual vs. auto-approval?)
- Override procedures (can users force-approve despite AI warnings?)
- Interaction with three-component automation triggers

**Implication:** You'll need to design these gates during implementation. Document your choices clearly.

### ⚠️ Time-Sensitive Deprecation: Act Now
As of July 16, 2026:
- **Deadline:** May 19, 2026 (PASSED)
- Any accounts still using ASC/AAC APIs are **already non-functional**
- **Action:** Your pipeline MUST target v25.0+ only. Do not support legacy APIs.

---

## 8. Agency Deployment Patterns (Research-Validated)

### The "Hibernate-and-Wake" Monitoring Loop
Agencies automate Meta Ads by:
1. **Staging Dashboard:** Campaign created in draft state, awaiting human approval
2. **Approval Phase:** User reviews targeting, creatives, budgets (72-hour approval window standard)
3. **Launch:** Upon approval, Media Buyer Agent sequences API calls to create campaign → adsets → ads
4. **Monitoring Loop:** Analyst Agent wakes daily (or every 4 hours for high-spend accounts) to:
   - Query `/insights` endpoint for Spend, CPA, ROAS, CTR, Frequency
   - Detect anomalies (sudden CPM spikes, CPA floor violations, creative fatigue)
   - Surface recommendations to dashboard (e.g., "Pause Ad ID 12345: CPA $52, exceeds $50 threshold")
5. **Execution:** Upon user click, Media Buyer Agent executes optimization (pause, reallocate, scale)

**Critical:** This is NOT autonomous. It's **guided autonomy**—agent proposes, human decides, agent executes.

### Audience Expansion Risk (Governance Issue)
Research reveals a critical governance gap:
- **Meta's Default Behavior:** Advantage+ Audience with `targeting_automation` enabled automatically **expands audiences beyond advertiser-specified demographics** without explicit notification
- **Risk:** Audience expansion can cannibalize targeted segments and dilute brand safety
- **Mitigation:** Explicitly set `targeting_automation: false` if you need tight audience control. Accept that you forfeit some of Meta's ML optimization.

---

## 9. Implementation Roadmap

### Phase 1: Months 1–2 (Read-Only Advisory)
- Build dashboard skeleton
- Parse business_profile.md into campaign JSON
- Call Meta API to **simulate** campaign creation (no actual spend)
- Render approval UI with all campaign details
- User must explicitly click "Approve" before any real API calls

### Phase 2: Months 3–4 (Budget Pacing)
- Agent allowed to shift **budgets inside existing CBO campaigns**
- Cannot launch new creatives or pause ads without approval
- Operates within pre-defined budget corridors (e.g., ±20% of daily budget)
- All budget changes still logged and reviewable

### Phase 3: Months 5+ (Full Loop)
- Agent detects creative fatigue (frequency >4, ROAS declining >20%)
- Generates new ad variants autonomously
- Pushes to API and prunes underperformers
- Can pause/resume ads within guardrails (CPA floors, ROAS minimums)

---

**STATUS:** Framework validated against 2026 industry data. Ready for implementation with Claude Sonnet/Opus.

**Last Updated:** July 16, 2026

---
