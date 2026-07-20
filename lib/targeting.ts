// Structured targeting input → sanitized, validated, Meta-ready data.
// Keeps Google Cloud out of the loop: the app cleans and formats the user's
// location/age/gender input, and the Copilot maps it into Meta's targeting
// schema (geo_locations / age_min / age_max / genders). Meta's own geo catalog
// can validate exact city keys later via lib/meta.searchGeo (follow-up).

import { cleanText } from "./sanitize";

export interface LocationInput {
  name: string; // city, address, or business name as the user typed it
  radiusKm: number; // 1–80 (Meta's custom-location radius ceiling)
}

export interface TargetingInput {
  locations: LocationInput[];
  ageMin?: number; // 18–65
  ageMax?: number; // 18–65
  gender?: "ALL" | "MALE" | "FEMALE";
}

export const META_MAX_RADIUS_KM = 80;
const MAX_LOCATIONS = 10;

/** Validate + sanitize one location row. Returns null if unusable. */
export function cleanLocation(raw: unknown): LocationInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = cleanText(typeof r.name === "string" ? r.name : "", 120);
  if (!name) return null;
  let radiusKm = Math.round(Number(r.radiusKm));
  if (!Number.isFinite(radiusKm)) radiusKm = 15;
  radiusKm = Math.min(META_MAX_RADIUS_KM, Math.max(1, radiusKm));
  return { name, radiusKm };
}

/**
 * Validate the whole structured targeting block. Returns { error } or the
 * cleaned { values } ready to persist and hand to the model.
 */
export function validateTargeting(body: unknown): { error: string } | { values: TargetingInput } {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawLocations = Array.isArray(b.locations) ? b.locations : [];
  const locations = rawLocations.map(cleanLocation).filter((l): l is LocationInput => l !== null).slice(0, MAX_LOCATIONS);

  // Age
  const clampAge = (v: unknown): number | undefined => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return undefined;
    return Math.min(65, Math.max(18, n));
  };
  const ageMin = b.ageMin === "" || b.ageMin == null ? undefined : clampAge(b.ageMin);
  const ageMax = b.ageMax === "" || b.ageMax == null ? undefined : clampAge(b.ageMax);
  if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax) {
    return { error: "Minimum age can't be greater than maximum age." };
  }

  const gender = b.gender === "MALE" || b.gender === "FEMALE" ? b.gender : "ALL";

  return { values: { locations, ageMin, ageMax, gender: gender as TargetingInput["gender"] } };
}

/** Meta gender codes: 1 = male, 2 = female; omit for all. */
export function metaGenders(gender?: TargetingInput["gender"]): number[] | undefined {
  if (gender === "MALE") return [1];
  if (gender === "FEMALE") return [2];
  return undefined;
}

/** Human-readable, model-facing description of the structured targeting. */
export function formatTargetingForModel(t: TargetingInput): string {
  const lines: string[] = [];
  if (t.locations.length) {
    lines.push("TARGET LOCATIONS (the user picked these explicitly — build geo_locations from them; use custom_locations with the given radius, or a matching Meta city key):");
    for (const l of t.locations) lines.push(`- ${l.name} — ${l.radiusKm}km radius`);
  }
  const age =
    t.ageMin !== undefined || t.ageMax !== undefined
      ? `AGE RANGE (user-set — honor exactly): ${t.ageMin ?? 18}–${t.ageMax ?? 65}`
      : "";
  if (age) lines.push(age);
  if (t.gender && t.gender !== "ALL") lines.push(`GENDER (user-set — honor exactly): ${t.gender}`);
  return lines.join("\n");
}
