import { cacheGet, cacheSet } from "./cache";
import { fetchWithBackoff } from "./http";
import { openMeteoBase } from "./openmeteo";
import { utcZLabel } from "./time";
import type { ModelRun, Station } from "./types";

export const MODEL_RUN_TTL_MS = 5 * 60 * 1000;
const PUBLIC_META_HOST = "https://api.open-meteo.com";

interface LatLon {
  lat: number;
  lon: number;
}

interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface ModelDataset {
  dataset: string;
  nest: string | null;
}

const ICON_D2: Box = { west: -3.94, east: 20.3, south: 43.18, north: 58.1 };
const ICON_EU: Box = { west: -23.5, east: 45.0, south: 29.5, north: 70.5 };
const UK_2KM: Box = { west: -11.0, east: 2.2, south: 49.8, north: 59.5 };
const AROME: Box = { west: -5.2, east: 9.6, south: 41.3, north: 51.5 };
const HARMONIE_NL: Box = { west: 3.2, east: 7.4, south: 50.7, north: 53.7 };
const HARMONIE_EU: Box = { west: -10, east: 32, south: 36, north: 71 };
const HRRR: Box = { west: -134, east: -60, south: 21, north: 53 };
const HRDPS: Box = { west: -141, east: -42, south: 37, north: 71 };
const RDPS: Box = { west: -150, east: -40, south: 30, north: 80 };
/** JMA MSM 5 km nest — Japan and the nearby East China Sea. */
const JMA_MSM: Box = { west: 120.0, east: 150.0, south: 22.4, north: 47.6 };

function inBox(p: LatLon, b: Box): boolean {
  return (
    p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east
  );
}

/**
 * Open-Meteo dataset behind a forecast `models=` id at this lat/lon.
 * Seamless blends pick the high-res nest that covers the station.
 */
export function datasetForModel(modelId: string, loc: LatLon): ModelDataset {
  switch (modelId) {
    case "icon_d2":
      return { dataset: "dwd_icon_d2", nest: null };
    case "icon_eu":
      return { dataset: "dwd_icon_eu", nest: null };
    case "icon_seamless":
      if (inBox(loc, ICON_D2))
        return { dataset: "dwd_icon_d2", nest: "ICON-D2" };
      if (inBox(loc, ICON_EU))
        return { dataset: "dwd_icon_eu", nest: "ICON-EU" };
      return { dataset: "dwd_icon", nest: "ICON global" };
    case "ukmo_uk_deterministic_2km":
      return { dataset: "ukmo_uk_deterministic_2km", nest: null };
    case "ukmo_seamless":
      if (inBox(loc, UK_2KM)) {
        return { dataset: "ukmo_uk_deterministic_2km", nest: "UK 2 km" };
      }
      return { dataset: "ukmo_global_deterministic_10km", nest: "UKMO global" };
    case "meteofrance_arome_france_hd":
      return { dataset: "meteofrance_arome_france_hd", nest: null };
    case "meteofrance_arome_france":
      return { dataset: "meteofrance_arome_france0025", nest: null };
    case "meteofrance_seamless":
      if (inBox(loc, AROME)) {
        return { dataset: "meteofrance_arome_france_hd", nest: "AROME HD" };
      }
      if (inBox(loc, ICON_EU)) {
        return { dataset: "meteofrance_arpege_europe", nest: "ARPEGE EU" };
      }
      return { dataset: "meteofrance_arpege_world025", nest: "ARPEGE" };
    case "knmi_harmonie_arome_netherlands":
      return { dataset: "knmi_harmonie_arome_netherlands", nest: null };
    case "knmi_harmonie_arome_europe":
      return { dataset: "knmi_harmonie_arome_europe", nest: null };
    case "knmi_seamless":
      if (inBox(loc, HARMONIE_NL)) {
        return {
          dataset: "knmi_harmonie_arome_netherlands",
          nest: "HARMONIE NL",
        };
      }
      if (inBox(loc, HARMONIE_EU)) {
        return { dataset: "knmi_harmonie_arome_europe", nest: "HARMONIE EU" };
      }
      return { dataset: "knmi_harmonie_arome_europe", nest: "HARMONIE EU" };
    case "ecmwf_ifs025":
      return { dataset: "ecmwf_ifs025", nest: null };
    case "ecmwf_aifs025_single":
      return { dataset: "ecmwf_aifs025_single", nest: null };
    case "cma_grapes_global":
      return { dataset: "cma_grapes_global", nest: null };
    case "jma_msm":
      return { dataset: "jma_msm", nest: null };
    case "jma_gsm":
      return { dataset: "jma_gsm", nest: null };
    case "jma_seamless":
      if (inBox(loc, JMA_MSM)) return { dataset: "jma_msm", nest: "JMA MSM" };
      return { dataset: "jma_gsm", nest: "JMA GSM" };
    case "gfs_hrrr":
      return { dataset: "ncep_hrrr_conus", nest: null };
    case "gfs_seamless":
      if (inBox(loc, HRRR)) return { dataset: "ncep_hrrr_conus", nest: "HRRR" };
      return { dataset: "ncep_gfs013", nest: "GFS" };
    case "gem_hrdps_continental":
      return { dataset: "cmc_gem_hrdps", nest: null };
    case "gem_seamless":
      if (inBox(loc, HRDPS)) return { dataset: "cmc_gem_hrdps", nest: "HRDPS" };
      if (inBox(loc, RDPS)) return { dataset: "cmc_gem_rdps", nest: "RDPS" };
      return { dataset: "cmc_gem_gdps", nest: "GDPS" };
    default:
      return { dataset: modelId, nest: null };
  }
}

interface MetaJson {
  last_run_initialisation_time?: number;
  last_run_availability_time?: number;
}

function unixToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function metaUrl(host: string, dataset: string): string {
  const url = new URL(
    `${host.replace(/\/$/, "")}/data/${dataset}/static/meta.json`,
  );
  const apiKey = process.env.OPEN_METEO_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);
  return url.toString();
}

async function fetchMetaJson(dataset: string): Promise<MetaJson | null> {
  const hosts = [openMeteoBase()];
  if (hosts[0] !== PUBLIC_META_HOST) hosts.push(PUBLIC_META_HOST);
  for (const host of hosts) {
    try {
      const res = await fetchWithBackoff(
        metaUrl(host, dataset),
        { headers: { Accept: "application/json" } },
        { timeoutMs: 4_000, retries: 0 },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as MetaJson;
      if (unixToIso(data.last_run_initialisation_time)) return data;
    } catch {
      // try next host
    }
  }
  return null;
}

async function metaForDataset(dataset: string): Promise<MetaJson | null> {
  const cacheKey = `om-meta:v1:${dataset}`;
  const cached = cacheGet<MetaJson | null>(cacheKey, MODEL_RUN_TTL_MS);
  if (cached?.fresh) return cached.value;
  const fresh = await fetchMetaJson(dataset);
  if (fresh) {
    cacheSet(cacheKey, fresh);
    return fresh;
  }
  return cached?.value ?? null;
}

function toRun(meta: MetaJson, spec: ModelDataset): ModelRun | null {
  const initAt = unixToIso(meta.last_run_initialisation_time);
  if (!initAt) return null;
  return {
    initAt,
    initZ: utcZLabel(initAt),
    availableAt: unixToIso(meta.last_run_availability_time),
    dataset: spec.dataset,
    nest: spec.nest,
  };
}

export async function fetchModelRuns(
  modelIds: string[],
  station: Pick<Station, "lat" | "lon">,
): Promise<Map<string, ModelRun>> {
  const loc = { lat: station.lat, lon: station.lon };
  const specs = new Map<string, ModelDataset>();
  for (const id of modelIds) {
    specs.set(id, datasetForModel(id, loc));
  }
  const unique = [...new Set([...specs.values()].map((s) => s.dataset))];
  const metas = await Promise.all(
    unique.map(
      async (dataset) => [dataset, await metaForDataset(dataset)] as const,
    ),
  );
  const byDataset = new Map(metas);
  const out = new Map<string, ModelRun>();
  for (const [id, spec] of specs) {
    const meta = byDataset.get(spec.dataset);
    if (!meta) continue;
    const run = toRun(meta, spec);
    if (run) out.set(id, run);
  }
  return out;
}
