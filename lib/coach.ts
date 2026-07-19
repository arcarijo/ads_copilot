import { prisma } from "./db";
import { Sections, sectionsFromLegacyMd } from "./profile";
import { PLATFORMS } from "./platforms";

// Deterministic marketing coach. Encodes what a senior venue/events promoter
// would check — profile depth, directive hygiene, performance vs industry
// benchmarks — as rule-based tips written for NON-expert operators. No AI
// call: these checks are cheap, reliable, and run on every dashboard load.
//
// Benchmark sources (2026 research): Meta events-vertical lead campaigns
// median CTR ~2.6%, CPL ~$28, cross-industry median CPA ~$38; venue industry
// speed-to-lead standard <30 min; wedding inquiries peak Jan–Feb, corporate
// Sep–Oct; ~57% of event tickets sell within 7 days of the event.

export interface CoachTip {
  severity: "act" | "consider";
  clientId?: string;
  clientName?: string;
  title: string;
  body: string; // plain English, teaches the "why", written for non-experts
  href: string; // where to go do it — includes #strategy-<key> when section-specific
}

const DIRECTIVE_STALE_DAYS = 45;

interface SectionCheck {
  key: string;
  test: (text: string, all: Sections) => boolean; // true = passes
  title: string;
  body: string;
}

// Expert-depth criteria: a section can be "filled" yet useless to a media
// buyer. These regexes check for the concrete details that actually change
// targeting and bidding decisions.
const SECTION_CHECKS: SectionCheck[] = [
  {
    key: "economics",
    test: (t) => /\$\s?\d/.test(t),
    title: "Put a dollar value on a booking",
    body:
      "Your Conversion Goals section has no dollar figures. Without knowing what an average booking is worth and what you'll pay for a lead, the AI can't judge whether $30 per inquiry is a win or a problem (the 2026 events-industry median is ~$28 per lead). Add: average booking value, and the most you'd happily pay for a qualified inquiry.",
  },
  {
    key: "audiences",
    test: (t) => /\d{2}\s?[-–]\s?\d{2}|\b\d{2}\+/.test(t),
    title: "Add age ranges to your audiences",
    body:
      "Your Target Audiences section names groups but no age ranges. \"Couples planning weddings\" could be 24–38 or 30–50 — Meta delivery treats those very differently. Add a realistic age band and one sentence on what motivates each group.",
  },
  {
    key: "geography",
    test: (t) => /\d+\s?(km|mile|kilomet|mi\b)|radius/i.test(t),
    title: "Pin down your geographic radius",
    body:
      "Your Geography section doesn't state a radius. How far do people actually travel to you? A venue that draws from 15km vs 50km needs completely different targeting — and this decides whether Advantage+ audience expansion helps or wastes spend.",
  },
  {
    key: "constraints",
    test: (t, all) => {
      const everything = Object.values(all).join(" ").toLowerCase();
      return /season|month|january|february|september|october|summer|winter|holiday|peak/i.test(everything);
    },
    title: "Tell the AI about your seasons",
    body:
      "Nothing in your profile mentions seasonality. In the events industry it's structural: wedding inquiries peak Jan–Feb, corporate events surge Sep–Oct. Which months are your busy and dead periods? Add it anywhere in the profile — the AI will shift angles and expectations with your calendar.",
  },
];

function parseSections(profile: { sectionsJson: string; profileMd: string } | null): Sections {
  if (!profile) return {};
  try {
    const s = JSON.parse(profile.sectionsJson) as Sections;
    if (s && Object.keys(s).length) return s;
  } catch {
    /* legacy fallback below */
  }
  return sectionsFromLegacyMd(profile.profileMd);
}

export async function getCoachTips(scope: { userId?: string } = {}, limit = 6): Promise<CoachTip[]> {
  const clients = await prisma.client.findMany({
    where: scope,
    include: {
      profile: true,
      campaigns: {
        where: { status: { in: ["ACTIVE", "PAUSED", "LAUNCHING"] } },
        include: { snapshots: { orderBy: { date: "desc" }, take: 14 } },
      },
      platforms: true,
    },
  });

  const tips: CoachTip[] = [];

  for (const client of clients) {
    const href = `/clients/${client.id}`;
    const sections = parseSections(client.profile);
    const hasAnyProfile = Object.values(sections).some((v) => (v ?? "").trim().length >= 20);
    const hasLiveCampaign = client.campaigns.some((c) => c.status === "ACTIVE");

    // --- Profile depth (only nag once there's a profile at all; the gap
    // banner on the client page already covers the empty case) ---
    if (hasAnyProfile) {
      for (const check of SECTION_CHECKS) {
        const text = (sections[check.key] ?? "").trim();
        if (text.length >= 20 && !check.test(text, sections)) {
          tips.push({
            severity: hasLiveCampaign ? "act" : "consider",
            clientId: client.id,
            clientName: client.name,
            title: check.title,
            body: check.body,
            // Deep-link straight to the section the advice is about.
            href: `${href}#strategy-${check.key}`,
          });
        }
      }

      // Speed-to-lead: the #1 venue conversion lever, invisible to ad metrics.
      const everything = Object.values(sections).join(" ").toLowerCase();
      if (hasLiveCampaign && !/respon|reply|follow.?up|inquir|enquir/.test(everything)) {
        tips.push({
          severity: "act",
          clientId: client.id,
          clientName: client.name,
          title: "Who answers ad inquiries, and how fast?",
          body:
            "Nothing in this profile describes how inquiries get handled. In venue marketing, responding within 30 minutes is the single biggest booking lever — slower response quietly destroys ad results in a way no metric will ever show. Add one line: who answers, on what channel, how fast.",
          href: `${href}#strategy-economics`,
        });
      }
    }

    // --- Directive hygiene ---
    const directive = client.profile?.directive?.trim() ?? "";
    const directiveAt = client.profile?.directiveAt ?? null;
    if (hasLiveCampaign && directive && directiveAt) {
      const ageDays = Math.floor((Date.now() - directiveAt.getTime()) / 86_400_000);
      if (ageDays > DIRECTIVE_STALE_DAYS) {
        tips.push({
          severity: "consider",
          clientId: client.id,
          clientName: client.name,
          title: `Manager Directive is ${ageDays} days old`,
          body:
            "The AI still weighs this directive first every day. If the business has moved on since it was written, it's now steering the campaign wrong — refresh it or clear it. A good directive names a priority, an angle to favor, and a constraint (e.g. \"push corporate holiday bookings, wind down wedding creative, keep spend flat\").",
          href,
        });
      } else if (directive.length < 40) {
        tips.push({
          severity: "consider",
          clientId: client.id,
          clientName: client.name,
          title: "Your directive is too vague to steer with",
          body:
            `"${directive.slice(0, 60)}" doesn't give the AI anything concrete to act on. Strong directives name a priority, an angle, and a constraint — what to push, what to wind down, what to hold steady.`,
          href,
        });
      }

      // Directive effectiveness: 7-day CPA before vs after the directive.
      const before: number[] = [];
      const after: number[] = [];
      const dirTime = directiveAt.getTime();
      for (const c of client.campaigns) {
        for (const s of c.snapshots) {
          if (s.cpaCents == null) continue;
          const t = new Date(`${s.date}T00:00:00Z`).getTime();
          const delta = (t - dirTime) / 86_400_000;
          if (delta >= 0 && delta <= 7) after.push(s.cpaCents);
          else if (delta < 0 && delta >= -7) before.push(s.cpaCents);
        }
      }
      if (before.length >= 3 && after.length >= 3) {
        const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const beforeAvg = avg(before);
        const afterAvg = avg(after);
        const pct = ((afterAvg - beforeAvg) / beforeAvg) * 100;
        if (Math.abs(pct) >= 15) {
          const improved = pct < 0;
          tips.push({
            severity: "consider",
            clientId: client.id,
            clientName: client.name,
            title: improved
              ? `Cost per booking inquiry dropped ${Math.abs(pct).toFixed(0)}% since your directive`
              : `Cost per booking inquiry rose ${pct.toFixed(0)}% since your directive`,
            body: improved
              ? `Average cost per conversion went from $${(beforeAvg / 100).toFixed(2)} to $${(afterAvg / 100).toFixed(2)} in the 7 days after you updated the directive. The steer is working — worth keeping, and noting what changed in your strategy profile so it persists.`
              : `Average cost per conversion went from $${(beforeAvg / 100).toFixed(2)} to $${(afterAvg / 100).toFixed(2)} in the 7 days after you updated the directive. That may be the market, or the steer — review whether the directive still matches what customers are actually booking.`,
            href,
          });
        }
      }
    }

    // --- Platform-vertical matchmaking: the profile reveals what they sell;
    // the registry knows which platform owns that vertical. Suggest, never
    // auto-enable — and only once a real profile exists. ---
    if (hasAnyProfile) {
      const everything = (Object.values(sections).join(" ") + " " + (client.profile?.marketsJson ?? "")).toLowerCase();
      const enabledPlatforms = new Set(client.platforms.filter((p) => p.enabled).map((p) => p.platform));
      for (const spec of PLATFORMS) {
        if (spec.key === "META" || enabledPlatforms.has(spec.key)) continue;
        const hits = spec.vertical.filter((v) => everything.includes(v));
        if (hits.length >= 2) {
          tips.push({
            severity: "consider",
            clientId: client.id,
            clientName: client.name,
            title: `Your ${hits[0]} business is a natural fit for ${spec.label}`,
            body: `${spec.tagline} ${spec.coaching[0]} You can toggle it on from this client's Platforms section — your admin handles the connection.`,
            href,
          });
          break; // one platform suggestion per client at a time — don't overwhelm
        }
      }

      // Platform-directive staleness: a stale platform steer quietly misleads
      // that platform's daily decisions, same as the global one.
      for (const conn of client.platforms) {
        if (!conn.enabled || !conn.directive.trim() || !conn.directiveAt) continue;
        const ageDays = Math.floor((Date.now() - conn.directiveAt.getTime()) / 86_400_000);
        if (ageDays > DIRECTIVE_STALE_DAYS) {
          tips.push({
            severity: "consider",
            clientId: client.id,
            clientName: client.name,
            title: `${conn.platform} directive is ${ageDays} days old`,
            body: `The ${conn.platform} steering note still guides that platform's decisions daily. If the packages or audiences you want there have shifted, refresh it — or clear it to fall back to your global direction.`,
            href,
          });
        }
      }
    }

    // --- Performance vs 2026 events-industry benchmarks ---
    for (const c of client.campaigns.filter((x) => x.status === "ACTIVE")) {
      const recent = c.snapshots.slice(0, 7).filter((s) => s.impressions > 500);
      if (recent.length < 3) continue;
      const avgCtr = recent.reduce((a, s) => a + s.ctr, 0) / recent.length;
      const cpas = recent.filter((s) => s.cpaCents != null).map((s) => s.cpaCents as number);
      const avgCpa = cpas.length ? cpas.reduce((a, b) => a + b, 0) / cpas.length : null;
      const avgFreq = recent.reduce((a, s) => a + s.frequency, 0) / recent.length;
      const campaignHref = `/campaigns/${c.id}`;

      if (avgCtr < 0.9) {
        tips.push({
          severity: "act",
          clientId: client.id,
          clientName: client.name,
          title: `"${c.name}": click rate is below the industry floor`,
          body:
            `7-day CTR is ${avgCtr.toFixed(2)}% — under the ~0.9% floor for events advertising (lead campaigns in this vertical average ~2.6%). In 2026, creative quality drives 50–70% of results: swap in real photos/video from actual events at the venue, and echo the language from your best reviews.`,
          href: campaignHref,
        });
      }
      if (avgCpa != null && avgCpa > 3800) {
        tips.push({
          severity: "act",
          clientId: client.id,
          clientName: client.name,
          title: `"${c.name}": cost per inquiry is above industry median`,
          body:
            `You're paying $${(avgCpa / 100).toFixed(2)} per conversion vs the ~$38 cross-industry median (events leads run ~$28). If your average booking is worth $1,000+ this may still be fine — which is exactly why the AI needs your booking value in the Conversion Goals section to judge it.`,
          href: campaignHref,
        });
      }
      if (avgFreq > 3.5) {
        tips.push({
          severity: "consider",
          clientId: client.id,
          clientName: client.name,
          title: `"${c.name}": the same people keep seeing your ads`,
          body:
            `Average frequency is ${avgFreq.toFixed(1)} — the local audience is getting saturated. Fresh creative resets attention, or this may be the moment to ask whether the geographic radius is too tight for the budget.`,
          href: campaignHref,
        });
      }
    }
  }

  // "act" first, then cap so the dashboard teaches without overwhelming.
  tips.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "act" ? -1 : 1));
  return tips.slice(0, limit);
}
