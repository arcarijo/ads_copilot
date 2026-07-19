\# 🗺️ REALISTIC\_AD\_MANAGER\_USECASE.md (Edge AI Native Blueprint)



This document defines the real-world operational context, architectural stack, and automated workflows for deploying local ad campaigns\[cite: 3]. 



\---



\## 🎯 Target Domain \& Business Scope

This pipeline is built to launch hyper-targeted local campaigns for \*\*event planners, studio venues, and rental businesses\*\* in Toronto, Hamilton, and across the Greater Toronto Area (GTA)\[cite: 3].

\*   \*\*Ad Budget Ranges:\*\* Low-tier, high-velocity tests ranging from \*\*$100 to $1,000 CAD\*\* over a timeline of \*\*1 week to 1 month\*\*\[cite: 3].

\*   \*\*Primary Destination:\*\* Instagram (Feed, Stories, Reels) configured with user-override options\[cite: 3].

\*   \*\*Ultimate Goal:\*\* Convert highly specific local creative assets into profitable physical bookings with zero wasted spend\[cite: 3].



\---



\## 💻 The 2026 "Zero-Dollar" Production Stack



To guarantee absolute financial efficiency, the architecture delegates tasks according to resource weight:



\*   \*\*User Interface \& API Routing:\*\* \*\*Next.js (App Router)\*\* hosted on \*\*Vercel (Hobby Tier)\*\*\[cite: 3].

\*   \*\*State \& Guardrail Persistence:\*\* \*\*Supabase or Neon PostgreSQL (Free Tier)\*\* to securely store active budgets, target criteria, user contact metadata, and historical telemetry\[cite: 3].

\*   \*\*Edge Optimizer (The Student Model):\*\* \*\*Cloudflare Workers AI\*\* running `@cf/meta/llama-3.2-3b-instruct` (100% free under Cloudflare's 10,000 daily neuron allotment).

\*   \*\*Deployment Pipeline:\*\* \*\*Meta Graph API v25.0+\*\* using unified Advantage+ optimization parameters (Campaign Budget Optimization, Advantage+ Audience, dynamic placements).

\*   \*\*Waking Mechanism:\*\* A native, secure cron loop triggered \*\*daily\*\* directly via Vercel's Hobby Tier native cron features to keep everything within free limits\[cite: 3].



\---



\## 🔄 Step-by-Step User Flow \& Guardrails



┌────────────────────────┐

│ 1. Conversational Form │ ──► Captures raw business insights \& uploads ad creative assets

└───────────┬────────────┘

▼

┌────────────────────────┐

│ 2. Probing Interactive │ ──► Next.js Chat resolves target gaps \& clarifies creative use

└───────────┬────────────┘

▼

┌────────────────────────┐

│   \[HITL GATE #1]       │ ──► User manually signs off on budget \& signs up for notifications

└───────────┬────────────┘

▼

┌────────────────────────┐

│ 4. Advantage+ Deploy   │ ──► Campaign goes live on Meta v25.0 with hard database limits

└───────────┬────────────┘

▼

┌────────────────────────┐

│ 5. Edge Check (Daily)  │ ──► Cloudflare Worker pulls v25.0 metrics \& triggers AI model

└───────────┬────────────┘

▼

Decision Loop:

├── NO BUDGET CHANGES ──► Auto-pauses failing creatives or shifts platform placements

└── BUDGET OVERRIDES ───► \[HITL GATE #2] Requires dashboard check/email MFA





\### 1. The Probing Questionnaire \& Intake UI

\*   \*\*How it works:\*\* The Vercel-hosted React frontend serves a casual, non-technical form tailored to venue owners\[cite: 3].

\*   \*\*Conversational Mapping:\*\* The system prompts: \*"Where do your physical clients travel from?"\* and maps it behind the scenes to `targeting.geo\_locations` (using specific city coordinates and a customized `15km` radius)\[cite: 3].

\*   \*\*Creative Asset Upload:\*\* Allows uploading multiple ad sets containing media assets (`.mp4`, `.jpg`) along with casual copy ideas\[cite: 3].



\### 2. The Interactive Chat Step

\*   \*\*How it works:\*\* If the user’s inputs are vague, Next.js calls a lightweight API to trigger Claude as a validation assistant\[cite: 3]. 

\*   \*\*Actionable Guardrail:\*\* The chat interface must address the user to resolve empty parameters (e.g., \*"I noticed you want bookings for your space in Hamilton, but target all of Toronto. Should we narrow our search radius to 25km around Hamilton to keep costs down?"\*).



\---



\### 🚦 HITL GATE #1: Proposed Budget Approval

Before a single API mutation is sent to Meta, the app must present a clear, structured campaign receipt to the user\[cite: 3]:

1\.  The UI displays the proposed audience reach, active ad sets, exact start/end dates, and a maximum total budget\[cite: 3].

2\.  The user \*\*must\*\* input their email and phone number to subscribe to notifications, then click \*\*"Approve and Launch"\*\*\[cite: 3].

3\.  Once clicked, the status in Supabase/Neon PostgreSQL switches from `DRAFT` to `APPROVED`\[cite: 3]. The budget is written to the DB as a database-enforced ceiling. \*\*The API wrapper must reject any request that exceeds this value\*\*\[cite: 3].



\---



\### 4. Advantage+ Pipeline Deployment

The system triggers the Meta API v25.0 wrapper to configure the campaign in a fully automated, machine-optimized state:

\*   \*\*The Advantage+ Formula:\*\* Enforce campaign-level CBO with `targeting\_automation: true` and empty placement fields to maximize delivery performance.

\*   \*\*Safety Precaution:\*\* If the business profile explicitly declares strict geographic targeting, change `targeting\_automation` to `false` to prevent "audience creep" beyond local municipal borders.



\### 5. Daily Edge Optimization \& AI Cost Transparency

Every 24 hours, the native Vercel cron wakes up the Cloudflare Worker\[cite: 3].

\*   \*\*Telemetry Gathering:\*\* The Worker fetches metric payload `/insights` directly from Meta v25.0\[cite: 3].

\*   \*\*Llama Inference Execution:\*\* The Worker executes `@cf/meta/llama-3.2-3b-instruct` to audit performance\[cite: 3].

\*   \*\*Compute Math Monitoring:\*\* The Worker tracks exact neuron consumption and logs it to Supabase\[cite: 3] using:

&#x20;   $$N\_{total} = (T\_{in} \\cdot R\_{in}) + (T\_{out} \\cdot R\_{out})$$

&#x20;   \*Where $T\_{in}/T\_{out}$ are tokens processed, and $R\_{in}/R\_{out}$ are the model's standard neuron billing rates.\*

\*   \*\*AI Cost Transparency:\*\* The Next.js dashboard reads this metadata and displays the exact cost in free daily Cloudflare Neurons used to execute the audits\[cite: 3].



\---



\### 🚦 HITL GATE #2: Absolute Spend Protection

\*   \*\*Autonomous Actions Allowed:\*\* If a specific creative is severely underperforming, the Cloudflare Worker is authorized to autonomously POST a change to pause that specific ad set, or adjust schedule parameters using the existing creatives\[cite: 3].

\*   \*\*Spend Modifications Blocked:\*\* Under no circumstances is the Worker or Vercel API authorized to write a budget increase or daily limit shift directly to Meta\[cite: 3].

\*   \*\*Notification Loop:\*\* If the Worker suggests scaling the budget (e.g., \*"CPA is $12, well under the $35 target. Recommend adding $150 to scale."\*\[cite: 3]), the campaign state switches to `PROPOSAL\_PENDING`. An email/SMS warning is pushed to the client with an approval link\[cite: 3].



\---



\## 🛠️ Instructions for Claude Code during Development



\*   \*\*Rule 1: Never bypass DB Guardrails.\*\* Ensure the Next.js API endpoint verifying the Meta payloads compares incoming budgets directly with the row-level security values in Postgres before executing the fetch\[cite: 3].

\*   \*\*Rule 2: Edge Decoupling.\*\* Ensure that the Next.js app does not perform the daily ad metrics checks inside serverless handlers\[cite: 3]. All daily evaluation tasks must be modularly offloaded to the Cloudflare Worker script (`src/index.js`) to keep execution paths clean and free\[cite: 3].

\*   \*\*Rule 3: Structured Worker Responses.\*\* Instruct Cloudflare's `@cf/meta/llama-3.2-3b-instruct` using system prompts that demand absolute, JSON-formatted output only (no markdown, no conversation).

