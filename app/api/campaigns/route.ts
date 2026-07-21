import { NextRequest, NextResponse } from "next/server";
import { prisma, log } from "@/lib/db";
import { runCopilot, QuestionnaireInput } from "@/lib/copilot";
import { runResearch } from "@/lib/research";
import { requireSession, campaignScope, canAccessClient, canAccessCampaign } from "@/lib/auth";
import { aiRateLimited } from "@/lib/rateLimit";
import { cleanText } from "@/lib/sanitize";
import { validateTargeting } from "@/lib/targeting";

export async function GET() {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const campaigns = await prisma.campaign.findMany({
    where: campaignScope(auth.session),
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: { orderBy: { date: "desc" }, take: 1 },
      alerts: { where: { acknowledged: false } },
    },
  });
  return NextResponse.json({ campaigns });
}

/**
 * Creates a draft campaign from the questionnaire, then immediately runs the
 * Pre-Launch Copilot. Responds with either clarifying questions or the plan.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  // EDoS guard: this path runs a 70B copilot inference (and possibly research).
  if (aiRateLimited(auth.session, req.headers)) {
    return NextResponse.json({ error: "Slow down — too many plan generations in a row. Try again shortly." }, { status: 429 });
  }
  const input = (await req.json().catch(() => ({}))) as QuestionnaireInput & { campaignId?: string };

  // Users must build campaigns under a client they own; legacy no-client
  // campaigns (env credentials) stay admin-only.
  if (auth.session.role === "user") {
    if (!input.clientId || !(await canAccessClient(auth.session, input.clientId))) {
      return NextResponse.json({ error: "Pick one of your businesses for this campaign." }, { status: 403 });
    }
    if (input.campaignId && !(await canAccessCampaign(auth.session, input.campaignId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  try {
    const budgetCents = Math.round(input.budgetDollars * 100);
    // Per-campaign steer + A/B intent, sanitized. Weighed by the copilot now
    // and by the daily optimizer once wired; editable after launch.
    const directive = cleanText(input.campaignDirective ?? "", 2000);
    const abNotes = input.abTest ? cleanText(input.abNotes ?? "", 2000) : "";
    // Sanitize/validate structured targeting (locations + age/gender) up front.
    const tv = validateTargeting(input.targeting);
    if ("error" in tv) return NextResponse.json({ error: tv.error }, { status: 422 });
    input.targeting = tv.values;
    const campaign = input.campaignId
      ? await prisma.campaign.findUniqueOrThrow({ where: { id: input.campaignId } })
      : await prisma.campaign.create({
          data: {
            clientId: input.clientId || null,
            name: input.campaignName,
            budgetCents,
            budgetType: input.budgetType,
            durationDays: input.durationDays,
            questionnaireJson: JSON.stringify(input),
            audienceJson: JSON.stringify({ targetAudience: input.targetAudience, geography: input.geography }),
            creativesJson: JSON.stringify(input.creatives),
            abTest: input.abTest,
            abVariable: input.abVariable,
            abNotes: abNotes || null,
            directive: directive || null,
            directiveAt: directive ? new Date() : null,
          },
        });

    const result = await runCopilot(input);

    if (result.status === "NEEDS_CLARIFICATION") {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: "NEEDS_CLARIFICATION",
          clarificationsJson: JSON.stringify(result.questions),
          questionnaireJson: JSON.stringify(input),
        },
      });
      return NextResponse.json({ campaignId: campaign.id, ...result });
    }

    // READY: persist plan and write the DB-enforced budget ceiling.
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "READY",
        aiPlanJson: JSON.stringify(result.plan),
        clarificationsJson: null,
        budgetCeilingCents: result.plan!.campaign.budgetCents,
        questionnaireJson: JSON.stringify(input),
        abNotes: abNotes || null,
        directive: directive || null,
        directiveAt: directive ? new Date() : null,
      },
    });

    // New-market detection: update the client's ground-truth profile and run
    // focused optimization research. Single pass, daily-capped inside runResearch.
    if (result.newMarket?.detected && input.clientId) {
      await log("COPILOT", `New market detected: ${result.newMarket.description}`, {
        campaignId: campaign.id,
      });
      const research = await runResearch(input.clientId, {
        type: "MARKET_EXTENSION",
        trigger: `campaign:${campaign.id}`,
        marketDescription: result.newMarket.description,
      });
      return NextResponse.json({ campaignId: campaign.id, ...result, research });
    }
    return NextResponse.json({ campaignId: campaign.id, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
