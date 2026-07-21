import { prisma, log } from "./db";
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  credsFromClient,
  envCreds,
  MetaCreds,
  setEntityStatus,
  uploadVideoFromUrl,
} from "./meta";
import { normalizeMediaUrl, looksLikeUrl, extractDriveFolderId, listDriveFolderImages } from "./drive";
import { assertBudgetAllowed } from "./guardrails";
import {
  CopilotPlan,
  CreativeInput,
  MetaAdSetPayload,
  MetaCampaignPayload,
  MetaCreativePayload,
} from "./types";

function creativePayload(c: CreativeInput, name: string, pageId: string): MetaCreativePayload {
  const link = c.linkUrl ?? "https://example.com";
  const base = { page_id: pageId };
  if (c.kind === "VIDEO") {
    return {
      name,
      object_story_spec: {
        ...base,
        video_data: {
          video_id: c.filePaths[0], // pre-uploaded video id or path placeholder
          message: c.primaryText,
          title: c.headline,
          call_to_action: { type: "LEARN_MORE", value: { link } },
        },
      },
    };
  }
  if (c.kind === "CAROUSEL") {
    return {
      name,
      object_story_spec: {
        ...base,
        link_data: {
          link,
          message: c.primaryText,
          child_attachments: c.filePaths.map((p, i) => ({
            link,
            name: c.headline ? `${c.headline} ${i + 1}` : undefined,
            picture: p,
          })),
        },
      },
    };
  }
  return {
    name,
    object_story_spec: {
      ...base,
      link_data: {
        link,
        message: c.primaryText,
        name: c.headline,
        picture: c.filePaths[0],
        call_to_action: { type: "LEARN_MORE", value: { link } },
      },
    },
  };
}

export async function resolveCampaignCreds(campaignId: string): Promise<MetaCreds> {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { client: true },
  });
  return campaign.client ? credsFromClient(campaign.client) : envCreds();
}

/**
 * Translates a validated CopilotPlan into the Meta creation sequence:
 * campaign -> ad sets -> creatives -> ads, using the owning client's
 * credentials. Enforces the DB budget ceiling immediately before
 * spend-bearing calls. Persists Meta IDs as it goes for auditability.
 */
export async function launchToMeta(campaignId: string): Promise<void> {
  const record = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { client: true },
  });
  if (record.status !== "READY") throw new Error(`Campaign is ${record.status}, not READY.`);
  const plan = JSON.parse(record.aiPlanJson ?? "null") as CopilotPlan | null;
  if (!plan) throw new Error("No approved AI plan on this campaign.");
  const creatives = JSON.parse(record.creativesJson) as CreativeInput[];

  const creds = record.client ? credsFromClient(record.client) : envCreds();
  const pageId = creds.pageId ?? process.env.META_PAGE_ID ?? "PAGE_ID_NOT_SET";

  // Resolve creative media without storing bytes: upload Drive/URL videos to
  // Meta (→ video_id, Meta hosts it) and normalize image links to fetchable
  // URLs. Already-uploaded video ids (non-URL) pass through untouched.
  for (const c of creatives) {
    if (c.kind === "VIDEO") {
      const src = c.filePaths[0];
      if (src && looksLikeUrl(src)) {
        const norm = normalizeMediaUrl(src);
        if (!norm) throw new Error(`Creative "${c.label}": that video link isn't a valid Google Drive share link or https URL.`);
        c.filePaths[0] = await uploadVideoFromUrl(creds, norm.url);
      }
    } else if (c.kind === "CAROUSEL") {
      // Meta carousels require 2–10 cards, images only.
      const links = c.filePaths.map((p) => p.trim()).filter(Boolean);
      // A single shared FOLDER link expands into the folder's images (2–10).
      const folderId = links.length === 1 ? extractDriveFolderId(links[0]) : null;
      if (folderId) {
        const folder = await listDriveFolderImages(folderId);
        if (!folder.ok) throw new Error(`Creative "${c.label}": ${folder.error}`);
        c.filePaths = folder.images.map((im) => `https://drive.google.com/uc?export=download&id=${im.id}`);
      } else {
        // Otherwise: 2–10 individual image links, each must normalize to a URL.
        if (links.length < 2 || links.length > 10) {
          throw new Error(`Creative "${c.label}": a carousel needs 2–10 image links, or one shared folder link (got ${links.length}).`);
        }
        c.filePaths = links.map((p) => {
          const norm = normalizeMediaUrl(p);
          if (!norm) throw new Error(`Creative "${c.label}": "${p.slice(0, 40)}…" isn't a valid Google Drive share link or https URL.`);
          return norm.url;
        });
      }
    } else {
      c.filePaths = c.filePaths.map((p) => normalizeMediaUrl(p)?.url ?? p);
    }
  }

  // HARD GUARDRAIL: compare against the DB-enforced ceiling written at approval.
  assertBudgetAllowed(plan.campaign.budgetCents, plan.campaign.budgetType, record.budgetCeilingCents);

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "LAUNCHING", lastError: null } });

  const start = new Date();
  const end = new Date(start.getTime() + record.durationDays * 86_400_000);

  const campaignPayload: MetaCampaignPayload = {
    name: plan.campaign.name,
    objective: plan.campaign.objective,
    status: "PAUSED", // created paused; final activation is the last step
    special_ad_categories: [],
    ...(plan.campaign.budgetType === "DAILY"
      ? { daily_budget: plan.campaign.budgetCents }
      : { lifetime_budget: plan.campaign.budgetCents }),
  };
  const metaCampaignId = await createCampaign(creds, campaignPayload);
  await prisma.campaign.update({ where: { id: campaignId }, data: { metaCampaignId } });
  await log("META", `Created Meta campaign ${metaCampaignId}`, { campaignId });

  const adSetIds: string[] = [];
  for (const [i, adSet] of plan.adSets.entries()) {
    const payload: MetaAdSetPayload = {
      name: adSet.name,
      campaign_id: metaCampaignId,
      status: "PAUSED",
      billing_event: "IMPRESSIONS",
      optimization_goal: adSet.optimizationGoal,
      targeting: adSet.targeting,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      attribution_spec: [
        { event_type: "CLICK_THROUGH", window_days: 7 },
        { event_type: "VIEW_THROUGH", window_days: 1 },
      ],
    };
    const id = await createAdSet(creds, payload);
    adSetIds.push(id);
    await log("META", `Created ad set ${i + 1}/${plan.adSets.length}: ${id}`, { campaignId });
  }
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { metaAdSetIdsJson: JSON.stringify(adSetIds) },
  });

  const adIds: string[] = [];
  for (const ad of plan.ads) {
    const creative = creatives.find((c) => c.label === ad.creativeLabel);
    if (!creative) throw new Error(`Creative "${ad.creativeLabel}" not found.`);
    const creativeId = await createAdCreative(creds, creativePayload(creative, `${ad.name} creative`, pageId));
    const adId = await createAd(creds, {
      name: ad.name,
      adset_id: adSetIds[ad.adSetIndex],
      creative: { creative_id: creativeId },
      status: "PAUSED",
    });
    adIds.push(adId);
    await log("META", `Created ad ${adId} (creative ${creativeId})`, { campaignId });
  }

  // Final activation: flip campaign + children to ACTIVE.
  for (const id of [...adIds, ...adSetIds, metaCampaignId]) {
    await setEntityStatus(creds, id, "ACTIVE");
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      metaAdIdsJson: JSON.stringify(adIds),
      startTime: start,
      endTime: end,
    },
  });
  await log("META", "Campaign launched and activated on Meta.", { campaignId });
}
