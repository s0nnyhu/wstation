import type { ModelRole, ModelRow, Region, Station } from "./types";

export const COMPARE_ALL_EUROPE = [
  "icon_seamless",
  "ukmo_seamless",
  "meteofrance_seamless",
  "gem_seamless",
  "knmi_seamless",
  "ecmwf_ifs025",
  "gfs_seamless",
] as const;

export const COMPARE_ALL_AMERICA = [
  "gfs_hrrr",
  "gfs_seamless",
  "gem_seamless",
  "gem_hrdps_continental",
  "icon_seamless",
  "ecmwf_ifs025",
  "ukmo_seamless",
] as const;

export const COMPARE_ALL_ASIA = [
  "ukmo_seamless",
  "icon_seamless",
  "ecmwf_ifs025",
  "ecmwf_aifs025_single",
  "gfs_seamless",
  "jma_seamless",
  "cma_grapes_global",
  "gem_seamless",
] as const;

export function compareAllFor(region: Region): readonly string[] {
  if (region === "america") return COMPARE_ALL_AMERICA;
  if (region === "asia") return COMPARE_ALL_ASIA;
  return COMPARE_ALL_EUROPE;
}

export const MODEL_LABELS: Record<string, string> = {
  icon_seamless: "ICON Seamless",
  icon_eu: "ICON-EU",
  icon_d2: "ICON-D2",
  ukmo_seamless: "UKMO Seamless",
  ukmo_uk_deterministic_2km: "UKMO UK 2km",
  knmi_seamless: "KNMI Seamless",
  knmi_harmonie_arome_netherlands: "HARMONIE-AROME NL",
  knmi_harmonie_arome_europe: "HARMONIE-AROME EU",
  meteofrance_seamless: "Météo-France Seamless",
  meteofrance_arome_france: "AROME France",
  meteofrance_arome_france_hd: "AROME France HD",
  gem_seamless: "GEM Seamless",
  gem_hrdps_continental: "GEM HRDPS",
  ecmwf_ifs025: "ECMWF IFS 0.25°",
  ecmwf_aifs025_single: "ECMWF AIFS",
  gfs_seamless: "GFS Seamless",
  gfs_hrrr: "HRRR",
  jma_seamless: "JMA Seamless",
  jma_msm: "JMA MSM",
  jma_gsm: "JMA GSM",
  cma_grapes_global: "CMA GRAPES",
};

export function modelLabel(id: string): string {
  return MODEL_LABELS[id] ?? id;
}

export function uniqueStrings(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Open-Meteo model family (issuing centre). A "seamless" model already uses
 * its centre's high-resolution run for the first ~48 h, so e.g. gfs_seamless
 * and gfs_hrrr, or icon_seamless and icon_d2, are the same series on the
 * market day. Consensus must count one vote per family, not per model id.
 */
export function modelFamily(id: string): string {
  const idx = id.indexOf("_");
  return idx === -1 ? id : id.slice(0, idx);
}

const ROLE_PRIORITY: Record<ModelRole, number> = {
  primary: 0,
  "short-range": 1,
  backup: 2,
  extra: 3,
  compare: 4,
};

export function rolePriority(role: ModelRole): number {
  return ROLE_PRIORITY[role];
}

/**
 * Rows that vote in the consensus: default-set roles only, one per model
 * family, ranked by role then by "has a bias sample". Pure so it can be tested.
 */
export function pickConsensusRows(rows: ModelRow[]): ModelRow[] {
  const rank = (r: ModelRow) =>
    rolePriority(r.role) * 2 + (r.bias.source === "none" ? 1 : 0);
  const byFamily = new Map<string, ModelRow>();
  for (const row of [...rows].sort((a, b) => rank(a) - rank(b))) {
    if (row.role !== "primary" && row.role !== "backup" && row.role !== "short-range") {
      continue;
    }
    if (row.correctedMaxC == null) continue;
    const family = modelFamily(row.id);
    if (!byFamily.has(family)) byFamily.set(family, row);
  }
  return [...byFamily.values()];
}

export function roleForModel(
  id: string,
  station: Pick<
    Station,
    "primary" | "primaryModels" | "shortRange" | "backups" | "domainExtras"
  >,
  compareAll: boolean,
): ModelRole {
  if (id === station.primary) return "primary";
  if (station.shortRange && id === station.shortRange) return "short-range";
  if (station.primaryModels.includes(id)) return "primary";
  if (station.backups.includes(id)) return "backup";
  if (compareAll && station.domainExtras.includes(id)) return "extra";
  return "compare";
}
