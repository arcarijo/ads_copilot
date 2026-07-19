import { createHash } from "crypto";
import { prisma, log } from "./db";
import {
  MetaCreds,
  addUsersToCustomAudience,
  createCustomAudience,
  createEngagementAudience,
  createLookalikeAudience,
  searchInterests,
} from "./meta";
import { MetaTargeting } from "./types";
import { Sections, sectionsFromLegacyMd } from "./profile";

// ---------------------------------------------------------------------------
// Audience Studio orchestration: maps what a venue owner actually KNOWS
// ("here are my past clients", "people who follow our page", "find me more
// people like my best customers") onto Meta's audience endpoints. The form
// specs live in lib/audienceKinds.ts (pure data, client-safe); this module
// owns hashing, catalog validation, Meta calls, and persistence.
// ---------------------------------------------------------------------------

export { AUDIENCE_KINDS } from "./audienceKinds";
export type { AudienceKindSpec } from "./audienceKinds";

// ---- PII normalization + hashing (Meta customer-file spec) ----

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export function normalizeContacts(raw: string): { schema: ("EMAIL" | "PHONE")[]; rows: string[][]; parsed: number; skipped: number } {
  const tokens = raw
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const emails: string[] = [];
  const phones: string[] = [];
  let skipped = 0;
  for (const t of tokens) {
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) {
      emails.push(sha256(t.toLowerCase()));
    } else {
      const digits = t.replace(/[^\d+]/g, "").replace(/^\+/, "");
      // Meta expects digits with country code; assume NA "1" when 10 digits.
      if (digits.length === 10) phones.push(sha256(`1${digits}`));
      else if (digits.length >= 11 && digits.length <= 15) phones.push(sha256(digits));
      else skipped++;
    }
  }
  // Column-aligned rows: EMAIL and PHONE uploaded as separate single-column rows.
  const rows: string[][] = [...emails.map((e) => [e, ""]), ...phones.map((p) => ["", p])];
  return { schema: ["EMAIL", "PHONE"], rows, parsed: emails.length + phones.length, skipped };
}

// ---- Blueprint construction from the strategy knowledge base ----

function parseSections(profile: { sectionsJson: string; profileMd: string } | null): Sections {
  if (!profile) return {};
  try {
    const s = JSON.parse(profile.sectionsJson) as Sections;
    if (s && Object.keys(s).length) return s;
  } catch {
    /* fall through */
  }
  return sectionsFromLegacyMd(profile.profileMd);
}

/**
 * Translate the Marketing Strategy sections into a Meta targeting spec:
 * age band from "Target Audiences", radius intent from "Geography", and
 * interest keywords resolved against Meta's LIVE catalog (never invented).
 * Returns the spec plus a plain-English note on what was derived from where.
 */
export async function buildBlueprintFromStrategy(
  creds: MetaCreds,
  clientId: string
): Promise<{ targeting: Partial<MetaTargeting>; note: string; resolvedInterests: string[] }> {
  const profile = await prisma.businessProfile.findUnique({ where: { clientId } });
  const sections = parseSections(profile);
  const audiences = sections.audiences ?? "";
  const geography = sections.geography ?? "";
  const notes: string[] = [];

  const targeting: Partial<MetaTargeting> = {};

  const ageMatch = audiences.match(/(\d{2})\s?[-–]\s?(\d{2})/);
  if (ageMatch) {
    targeting.age_min = Math.max(18, parseInt(ageMatch[1], 10));
    targeting.age_max = Math.min(65, parseInt(ageMatch[2], 10));
    notes.push(`ages ${targeting.age_min}–${targeting.age_max} from your Target Audiences section`);
  }

  const tight = /municipal|tight|strict|local only|no expansion|stay within/i.test(geography);
  targeting.targeting_automation = { advantage_audience: tight ? 0 : 1 };
  notes.push(tight ? "audience expansion OFF (your geography says stay tight)" : "audience expansion ON");

  // Interest resolution: pull candidate keywords from markets + audiences and
  // validate each against Meta's Targeting Search. Deprecated/unknown terms
  // simply drop out — IDs are never fabricated.
  const markets: string[] = profile ? (JSON.parse(profile.marketsJson) as string[]) : [];
  const candidates = [...new Set([...markets, ...audiences.split(/[,;.\n]/)])]
    .map((s) => s.replace(/^[-•\s]+/, "").trim())
    .filter((s) => s.length >= 4 && s.length <= 40)
    .slice(0, 6);
  const resolved: { id: string; name: string }[] = [];
  for (const c of candidates) {
    try {
      const hits = await searchInterests(creds, c);
      if (hits[0]) resolved.push({ id: hits[0].id, name: hits[0].name });
    } catch {
      // Search failures never block the blueprint — interests are optional.
    }
  }
  const deduped = [...new Map(resolved.map((r) => [r.id, r])).values()].slice(0, 8);
  if (deduped.length) {
    targeting.interests = deduped;
    notes.push(`${deduped.length} interests validated against Meta's live catalog (${deduped.map((d) => d.name).join(", ")})`);
  }

  return { targeting, note: `Derived: ${notes.join("; ")}.`, resolvedInterests: deduped.map((d) => d.name) };
}

// ---- Creation orchestrators (persist a MetaAudience row per asset) ----

export async function createAudience(
  creds: MetaCreds,
  clientId: string,
  kind: string,
  input: Record<string, string>
): Promise<{ id: string; metaAudienceId: string | null; summary: string }> {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Audience name is required.");

  if (kind === "CUSTOMER_LIST") {
    const { schema, rows, parsed, skipped } = normalizeContacts(input.contacts ?? "");
    if (parsed === 0) throw new Error("No valid emails or phone numbers found in the list.");

    // Update mode: re-upload into an existing customer-list audience instead
    // of creating a new one — Meta dedupes matched people automatically.
    if (input.existingAudienceLocalId) {
      const existing = await prisma.metaAudience.findUnique({ where: { id: input.existingAudienceLocalId } });
      if (!existing?.metaAudienceId || existing.clientId !== clientId || existing.kind !== "CUSTOMER_LIST") {
        throw new Error("Pick one of this client's existing customer lists to update.");
      }
      const { received, invalid } = await addUsersToCustomAudience(creds, existing.metaAudienceId, schema, rows);
      let prior: { uploaded?: number } = {};
      try {
        prior = JSON.parse(existing.specJson);
      } catch {
        /* fresh spec */
      }
      const totalUploaded = (prior.uploaded ?? 0) + parsed;
      await prisma.metaAudience.update({
        where: { id: existing.id },
        data: {
          sourceNote: `Customer list: ${totalUploaded} hashed contacts uploaded across updates (latest: ${parsed} added, ${skipped} skipped). Meta dedupes matches automatically.`,
          specJson: JSON.stringify({ uploaded: totalUploaded, lastReceived: received, lastInvalid: invalid }),
        },
      });
      await log("META", `Custom Audience "${existing.name}" updated (+${parsed} hashed contacts).`, { detail: { clientId } });
      return {
        id: existing.id,
        metaAudienceId: existing.metaAudienceId,
        summary: `Added ${parsed} hashed contacts to "${existing.name}" (${skipped} unparseable skipped). Meta matches and dedupes them over the next few hours — the audience keeps its ID, so live ads using it update automatically.`,
      };
    }

    const metaId = await createCustomAudience(creds, { name, description: "Created by Copilot Audience Studio" });
    const { received, invalid } = await addUsersToCustomAudience(creds, metaId, schema, rows);
    const row = await prisma.metaAudience.create({
      data: {
        clientId, kind, name, metaAudienceId: metaId,
        sourceNote: `Customer list: ${parsed} contacts uploaded (hashed), ${skipped} unparseable skipped.`,
        specJson: JSON.stringify({ uploaded: parsed, received, invalid }),
      },
    });
    await log("META", `Custom Audience "${name}" created (${metaId}), ${parsed} hashed contacts uploaded.`, { detail: { clientId } });
    return { id: row.id, metaAudienceId: metaId, summary: `Uploaded ${parsed} hashed contacts (${skipped} skipped). Meta will match them over the next few hours.` };
  }

  if (kind === "ENGAGEMENT") {
    const retentionDays = Math.min(365, Math.max(1, parseInt(input.retentionDays ?? "180", 10) || 180));
    const metaId = await createEngagementAudience(creds, { name, retentionDays });
    const row = await prisma.metaAudience.create({
      data: {
        clientId, kind, name, metaAudienceId: metaId,
        sourceNote: `Page engagers, last ${retentionDays} days.`,
        specJson: JSON.stringify({ retentionDays }),
      },
    });
    await log("META", `Engagement audience "${name}" created (${metaId}).`, { detail: { clientId } });
    return { id: row.id, metaAudienceId: metaId, summary: `Meta is now collecting everyone who engaged with your Page in the last ${retentionDays} days.` };
  }

  if (kind === "LOOKALIKE") {
    const origin = await prisma.metaAudience.findUnique({ where: { id: input.originAudienceLocalId ?? "" } });
    if (!origin?.metaAudienceId || origin.clientId !== clientId) {
      throw new Error("Pick a valid source audience that exists on Meta first.");
    }
    const ratio = (parseInt(input.ratio ?? "1", 10) || 1) / 100;
    const country = (input.country ?? "CA").toUpperCase();
    const metaId = await createLookalikeAudience(creds, { name, originAudienceId: origin.metaAudienceId, country, ratio });
    const row = await prisma.metaAudience.create({
      data: {
        clientId, kind, name, metaAudienceId: metaId,
        sourceNote: `Lookalike of "${origin.name}" — top ${Math.round(ratio * 100)}% in ${country}.`,
        specJson: JSON.stringify({ originAudienceId: origin.metaAudienceId, ratio, country }),
      },
    });
    await log("META", `Lookalike "${name}" created (${metaId}) from ${origin.metaAudienceId}.`, { detail: { clientId } });
    return { id: row.id, metaAudienceId: metaId, summary: `Meta is building the top ${Math.round(ratio * 100)}% of ${country} most similar to "${origin.name}". Ready in a few hours.` };
  }

  if (kind === "BLUEPRINT") {
    const { targeting, note } = await buildBlueprintFromStrategy(creds, clientId);
    const row = await prisma.metaAudience.create({
      data: { clientId, kind, name, metaAudienceId: null, sourceNote: note, specJson: JSON.stringify(targeting) },
    });
    await log("META", `Targeting blueprint "${name}" built from strategy. ${note}`, { detail: { clientId } });
    return { id: row.id, metaAudienceId: null, summary: note };
  }

  throw new Error(`Unknown audience kind "${kind}".`);
}
