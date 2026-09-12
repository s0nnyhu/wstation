import { describe, expect, it } from "vitest";
import { modelFamily, pickConsensusRows, roleForModel } from "./models";
import type { BiasResolution, ModelRole, ModelRow } from "./types";

function bias(source: BiasResolution["source"]): BiasResolution {
  return {
    season: "SON",
    source,
    unit: "C",
    biasNative: source === "none" ? null : 0.1,
    biasC: source === "none" ? 0 : 0.1,
    n: source === "none" ? 0 : 100,
  };
}

function row(
  id: string,
  role: ModelRole,
  correctedMaxC: number | null,
  source: BiasResolution["source"] = "season",
): ModelRow {
  return {
    id,
    label: id,
    role,
    rawMaxC: correctedMaxC,
    rawMinC: null,
    biasC: 0,
    bias: bias(source),
    correctedMaxC,
    deltaVsPrimaryC: null,
    available: correctedMaxC != null,
  };
}

describe("modelFamily", () => {
  it("groups Open-Meteo ids by issuing centre", () => {
    expect(modelFamily("gfs_seamless")).toBe("gfs");
    expect(modelFamily("gfs_hrrr")).toBe("gfs");
    expect(modelFamily("icon_d2")).toBe("icon");
    expect(modelFamily("gem_hrdps_continental")).toBe("gem");
    expect(modelFamily("knmi_harmonie_arome_netherlands")).toBe("knmi");
    expect(modelFamily("ecmwf_ifs025")).toBe("ecmwf");
  });
});

describe("pickConsensusRows", () => {
  it("keeps one vote per family, preferring the primary over its short-range twin", () => {
    const rows = [
      row("gfs_hrrr", "short-range", 26.6),
      row("gfs_seamless", "primary", 26.6),
      row("icon_seamless", "backup", 25.8),
    ];
    const picked = pickConsensusRows(rows).map((r) => r.id);
    expect(picked).toEqual(["gfs_seamless", "icon_seamless"]);
  });

  it("ignores compare/extra rows and rows without a corrected value", () => {
    const rows = [
      row("icon_seamless", "primary", 21.1),
      row("ecmwf_ifs025", "compare", 20.5),
      row("knmi_harmonie_arome_netherlands", "extra", 22.0),
      row("ukmo_seamless", "backup", null),
    ];
    expect(pickConsensusRows(rows).map((r) => r.id)).toEqual(["icon_seamless"]);
  });

  it("at equal role prefers the row that has a bias sample", () => {
    const rows = [
      row("knmi_harmonie_arome_netherlands", "backup", 22.0, "none"),
      row("knmi_seamless", "backup", 22.0, "season"),
      row("icon_seamless", "primary", 21.1),
    ];
    expect(pickConsensusRows(rows).map((r) => r.id)).toEqual([
      "icon_seamless",
      "knmi_seamless",
    ]);
  });

  it("KAUS-style: two primaries from different families both vote", () => {
    const rows = [
      row("gfs_hrrr", "short-range", 38.6),
      row("gem_seamless", "primary", 37.9),
      row("gfs_seamless", "primary", 38.6),
      row("icon_seamless", "backup", 37.8),
    ];
    expect(pickConsensusRows(rows).map((r) => r.id)).toEqual([
      "gem_seamless",
      "gfs_seamless",
      "icon_seamless",
    ]);
  });
});

describe("roleForModel", () => {
  const station = {
    primary: "gfs_seamless",
    primaryModels: ["gfs_hrrr", "gfs_seamless"],
    shortRange: "gfs_hrrr",
    backups: ["icon_seamless"],
    domainExtras: ["gfs_hrrr"],
  };

  it("labels roles in priority order", () => {
    expect(roleForModel("gfs_seamless", station, false)).toBe("primary");
    expect(roleForModel("gfs_hrrr", station, false)).toBe("short-range");
    expect(roleForModel("icon_seamless", station, false)).toBe("backup");
    expect(roleForModel("ecmwf_ifs025", station, true)).toBe("compare");
  });
});
