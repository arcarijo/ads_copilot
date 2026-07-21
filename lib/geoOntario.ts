// Curated Greater-Toronto-Area / Southern-Ontario geography so clients can pick
// a host city + a coverage "ladder" instead of typing cities one at a time. The
// app expands the choice into concrete Meta locations (named cities + radii, or
// a region/country note) and surfaces strategy-aware hints. No external API.

export type CoverageTier =
  | "JUST_CITY"
  | "CITY_PLUS_NEARBY"
  | "GTA"
  | "SOUTHERN_ONTARIO"
  | "ONTARIO"
  | "CANADA";

export type CitySize = "large" | "mid" | "small";

export interface OntarioCity {
  name: string;
  size: CitySize;
}

// Practical curated set for the GTA + Southern Ontario. Not exhaustive — covers
// where these clients actually run events/studios.
export const ONTARIO_CITIES: OntarioCity[] = [
  { name: "Toronto", size: "large" },
  { name: "Mississauga", size: "large" },
  { name: "Brampton", size: "large" },
  { name: "Hamilton", size: "large" },
  { name: "Markham", size: "large" },
  { name: "Vaughan", size: "large" },
  { name: "London", size: "large" },
  { name: "Ottawa", size: "large" },
  { name: "Kitchener", size: "mid" },
  { name: "Waterloo", size: "mid" },
  { name: "Cambridge", size: "mid" },
  { name: "Windsor", size: "mid" },
  { name: "Oakville", size: "mid" },
  { name: "Burlington", size: "mid" },
  { name: "Oshawa", size: "mid" },
  { name: "Whitby", size: "mid" },
  { name: "Barrie", size: "mid" },
  { name: "Guelph", size: "mid" },
  { name: "St. Catharines", size: "mid" },
  { name: "Niagara Falls", size: "mid" },
  { name: "Kingston", size: "mid" },
  { name: "Richmond Hill", size: "mid" },
  { name: "Brantford", size: "mid" },
  { name: "Milton", size: "small" },
  { name: "Newmarket", size: "small" },
  { name: "Aurora", size: "small" },
  { name: "Ajax", size: "small" },
  { name: "Pickering", size: "small" },
  { name: "Georgetown", size: "small" },
  { name: "Stouffville", size: "small" },
  { name: "Caledon", size: "small" },
  { name: "Halton Hills", size: "small" },
];

const CITY_INDEX: Record<string, OntarioCity> = Object.fromEntries(
  ONTARIO_CITIES.map((c) => [c.name.toLowerCase(), c]),
);

// GO Transit corridors — used for "city + nearby" so local events can pull
// audiences along the transit lines people actually commute on.
export const GO_CORRIDORS: Record<string, string[]> = {
  "Lakeshore West": ["Toronto", "Mississauga", "Oakville", "Burlington", "Hamilton", "St. Catharines", "Niagara Falls"],
  "Lakeshore East": ["Toronto", "Pickering", "Ajax", "Whitby", "Oshawa"],
  Kitchener: ["Toronto", "Brampton", "Georgetown", "Guelph", "Kitchener", "Waterloo"],
  Milton: ["Toronto", "Mississauga", "Milton"],
  Barrie: ["Toronto", "Vaughan", "Aurora", "Newmarket", "Barrie"],
  Stouffville: ["Toronto", "Markham", "Stouffville"],
  "Richmond Hill": ["Toronto", "Richmond Hill"],
};

// Core GTA municipalities (named-city targeting for the "Whole GTA" tier is
// anchored on a few big centres with wide radii to cover the rest efficiently).
const GTA_ANCHORS = [
  { name: "Toronto", radiusKm: 40 },
  { name: "Hamilton", radiusKm: 25 },
  { name: "Oshawa", radiusKm: 25 },
];

const SOUTHERN_ANCHORS = [
  ...GTA_ANCHORS,
  { name: "London", radiusKm: 30 },
  { name: "Kitchener", radiusKm: 25 },
  { name: "Barrie", radiusKm: 25 },
  { name: "St. Catharines", radiusKm: 25 },
  { name: "Kingston", radiusKm: 25 },
];

export interface ResolvedLocation {
  name: string;
  radiusKm: number;
}

export interface CoverageResolution {
  locations: ResolvedLocation[]; // named cities + radius (city-level tiers)
  coverageNote: string; // natural-language for the model (esp. region/country tiers + intent)
  hints: string[]; // strategy guidance surfaced in the UI
  corridorsUsed: string[];
}

export function citySize(name: string): CitySize | null {
  return CITY_INDEX[name.trim().toLowerCase()]?.size ?? null;
}

/** GO corridors the host city sits on. */
export function corridorsFor(city: string): string[] {
  const key = city.trim().toLowerCase();
  return Object.entries(GO_CORRIDORS)
    .filter(([, towns]) => towns.some((t) => t.toLowerCase() === key))
    .map(([line]) => line);
}

export const TIER_LABELS: Record<CoverageTier, string> = {
  JUST_CITY: "Just my city",
  CITY_PLUS_NEARBY: "My city + nearby towns",
  GTA: "The whole GTA",
  SOUTHERN_ONTARIO: "Southern Ontario",
  ONTARIO: "All of Ontario",
  CANADA: "All of Canada",
};

export const TIER_ORDER: CoverageTier[] = ["JUST_CITY", "CITY_PLUS_NEARBY", "GTA", "SOUTHERN_ONTARIO", "ONTARIO", "CANADA"];

/**
 * Expand a host city + coverage tier into concrete Meta locations + guidance.
 * `useCorridors` includes GO-transit-corridor towns for the CITY_PLUS_NEARBY tier.
 */
export function resolveCoverage(
  hostCityRaw: string,
  tier: CoverageTier,
  useCorridors = true,
): CoverageResolution {
  const hostCity = hostCityRaw.trim();
  const size = citySize(hostCity);
  const hints: string[] = [];
  let locations: ResolvedLocation[] = [];
  let coverageNote = "";
  let corridorsUsed: string[] = [];

  switch (tier) {
    case "JUST_CITY":
      locations = hostCity ? [{ name: hostCity, radiusKm: 15 }] : [];
      coverageNote = `Target ${hostCity || "the host city"} only (tight local radius).`;
      if (size === "small") {
        hints.push(
          `${hostCity} is a smaller city — most of your potential audience lives in nearby larger centres. Consider "My city + nearby towns" or "The whole GTA" to reach more people for the same spend.`,
        );
      }
      break;

    case "CITY_PLUS_NEARBY": {
      const corridors = useCorridors ? corridorsFor(hostCity) : [];
      corridorsUsed = corridors;
      const nearby = new Set<string>();
      for (const line of corridors) for (const town of GO_CORRIDORS[line]) if (town.toLowerCase() !== hostCity.toLowerCase()) nearby.add(town);
      locations = [
        ...(hostCity ? [{ name: hostCity, radiusKm: 20 }] : []),
        ...[...nearby].slice(0, 6).map((n) => ({ name: n, radiusKm: 15 })),
      ];
      coverageNote = corridors.length
        ? `Target ${hostCity} plus towns along its GO transit corridor(s): ${corridors.join(", ")}.`
        : `Target ${hostCity} plus its immediately neighbouring towns.`;
      if (!corridors.length && hostCity) {
        hints.push(`${hostCity} isn't on a major GO corridor in our map — this falls back to a wider radius around it. Use "Advanced" below to name specific nearby towns if you want precision.`);
      }
      if (size === "large") {
        hints.push(`${hostCity} is already a large market — pulling in small nearby towns rarely lifts results and can dilute spend. A tight local focus usually performs better.`);
      }
      break;
    }

    case "GTA":
      locations = GTA_ANCHORS.map((a) => ({ ...a }));
      coverageNote = "Target the whole Greater Toronto Area (anchored on Toronto, Hamilton, and Oshawa with wide radii).";
      if (size === "small") hints.push(`Good call — from ${hostCity}, opening up to the whole GTA reaches the large audiences in Toronto and its suburbs.`);
      break;

    case "SOUTHERN_ONTARIO":
      locations = SOUTHERN_ANCHORS.map((a) => ({ ...a }));
      coverageNote = "Target Southern Ontario: the GTA plus London, Kitchener-Waterloo, Barrie, Niagara, and Kingston.";
      if (size && size !== "large") {
        hints.push("Southern Ontario is broad. For a local event or studio, results usually come from close to home — make sure the wider reach is worth it, or the AI may spread spend thin.");
      }
      break;

    case "ONTARIO":
      locations = [];
      coverageNote = "Target the entire province of Ontario, Canada (region-level targeting).";
      hints.push("Province-wide is rarely right for a local event or studio — expect a higher cost per result unless you genuinely serve all of Ontario.");
      break;

    case "CANADA":
      locations = [];
      coverageNote = "Target all of Canada (country-level targeting).";
      hints.push("Nationwide targeting almost never pays off for a local business — only use it if you truly sell across the country.");
      break;
  }

  return { locations, coverageNote, hints, corridorsUsed };
}
