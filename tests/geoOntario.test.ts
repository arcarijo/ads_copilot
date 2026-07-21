import { describe, it, expect } from "vitest";
import { cityKey, corridorsFor, citySize, resolveCoverage } from "../lib/geoOntario";

describe("cityKey", () => {
  it("strips province/country suffixes and lowercases", () => {
    expect(cityKey("Toronto, ON")).toBe("toronto");
    expect(cityKey("  Milton , Ontario ")).toBe("milton");
    expect(cityKey("Hamilton")).toBe("hamilton");
    expect(cityKey("")).toBe("");
  });
});

describe("corridorsFor (province-suffixed input)", () => {
  it("matches Toronto even when typed as 'Toronto, ON' (the transit hub)", () => {
    const corridors = corridorsFor("Toronto, ON");
    // Toronto (Union Station) sits on every GO corridor in our map.
    expect(corridors.length).toBeGreaterThan(0);
    expect(corridors).toContain("Lakeshore West");
  });
  it("matches a suburb typed with the province suffix", () => {
    expect(corridorsFor("Milton, ON")).toContain("Milton");
  });
  it("returns empty for an unknown place", () => {
    expect(corridorsFor("Nowheresville, ON")).toEqual([]);
  });
});

describe("citySize (province-suffixed input)", () => {
  it("resolves size regardless of the province suffix", () => {
    expect(citySize("Toronto, ON")).toBe("large");
    expect(citySize("Milton, ON")).toBe("small");
  });
});

describe("resolveCoverage", () => {
  it("hands Meta a clean city name (no province suffix)", () => {
    const r = resolveCoverage("Toronto, ON", "JUST_CITY", true);
    expect(r.locations[0].name).toBe("Toronto");
  });
  it("includes corridor towns for a suffixed hub city on CITY_PLUS_NEARBY", () => {
    const r = resolveCoverage("Toronto, ON", "CITY_PLUS_NEARBY", true);
    expect(r.corridorsUsed.length).toBeGreaterThan(0);
    expect(r.locations.length).toBeGreaterThan(1); // host + nearby corridor towns
  });
});
