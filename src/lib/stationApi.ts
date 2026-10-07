import { assembleStation } from "./assemble";
import { getStation, polymarketEventSlug, polymarketEventUrl } from "@/config/stations";
import type {
  HuskyPayload,
  MarketDay,
  MetarPayload,
  ModelRow,
  PwsPayload,
  StationPayload,
  SynopticPayload,
  TempUnit,
  WuPayload,
} from "./types";

export type ApiMarketDay = "now" | "tomorrow";

export interface PublicModelRow {
  id: string;
  label: string;
  /** True when this model is a station primary (role `primary`). */
  primary: boolean;
  role: ModelRow["role"];
  available: boolean;
  raw_max_c: number | null;
  raw_min_c: number | null;
  corrected_max_c: number | null;
  /** Walk-forward bias (forecast − METAR max), ensemble stations only; corrected = raw − bias. */
  bias_c: number | null;
  bias_n: number | null;
  /** Ensemble stations: selected | eligible | redundant | no-skill-yet | no-correction | missing. */
  status?: string;
  /** Ensemble stations: weight in the blend. */
  weight?: number | null;
  note?: string;
  run?: {
    init_at: string;
    init_z: string;
    available_at: string | null;
    nest: string | null;
  };
}

export interface PublicWu {
  ok: boolean;
  error?: string;
  station_id?: string;
  daily_max_c: number | null;
  predicted_high_c: number | null;
  low_c: number | null;
  current_temp_c: number | null;
  stale: boolean;
  url?: string;
}

export interface PublicPws {
  id: string;
  source: string;
  name: string | null;
  url: string;
  ok: boolean;
  error?: string;
  temp_c: number | null;
  observed_at: string | null;
  /** PWS minus latest METAR, °C (positive = PWS warmer). */
  delta_vs_metar_c: number | null;
}

export interface PublicHusky {
  ok: boolean;
  error?: string;
  daily_max_c: number | null;
  local_date?: string | null;
  stale: boolean;
  url: string;
}

export interface PublicMetar {
  ok: boolean;
  error?: string;
  running_max_c: number | null;
  resolution_max_c: number | null;
  running_max_at?: string | null;
  latest_temp_c: number | null;
  stale: boolean;
}

export interface PublicSynoptic {
  ok: boolean;
  configured: boolean;
  error?: string;
  resolution_max: number | null;
  unit: TempUnit;
  stale: boolean;
}

export interface PublicStationResponse {
  icao: string;
  city: string;
  name: string;
  region: StationPayload["station"]["region"];
  timezone: string;
  unit: TempUnit;
  day: ApiMarketDay;
  market_date: string;
  /** UTC timestamp of this API request. */
  date_requested: string;
  /** Reference model (hourly chart / drivers). */
  primary_model: string;
  primary_models: string[];
  models: PublicModelRow[];
  /** Ensemble stations: mean raw max of the blend members. Elsewhere: raw median, one vote per family. */
  consensus_raw_c: number | null;
  /** Ensemble stations: the calibrated blend. Null elsewhere (no correction). */
  consensus_corrected_c: number | null;
  /** Calibrated distribution of the METAR daily max (ensemble stations), else null. */
  ensemble: PublicEnsemble | null;
  /** Polymarket event slug for the market local date, e.g. highest-temperature-in-munich-on-september-16-2026. */
  polymarket_slug: string | null;
  polymarket_url: string | null;
  wunderground: PublicWu;
  husky: PublicHusky;
  metar: PublicMetar;
  synoptic: PublicSynoptic;
  pws: PublicPws[];
}

export interface PublicEnsemble {
  ok: boolean;
  error?: string;
  lead: string;
  recipe_date?: string;
  generated_utc?: string;
  blend_c?: number;
  mu_c?: number | null;
  sd_c?: number | null;
  most_likely_c?: number | null;
  most_likely_p?: number | null;
  range80_c?: { lo: number; hi: number } | null;
  /** P(METAR daily max = k °C). */
  probs?: Array<{ k: number; p: number }>;
  truncated_at_c?: number | null;
}

export function parseApiDay(
  value: string | null | undefined,
): ApiMarketDay | null {
  if (value == null || value === "") return "now";
  const v = value.trim().toLowerCase();
  if (v === "now" || v === "today") return "now";
  if (v === "tomorrow") return "tomorrow";
  return null;
}

export function toMarketDay(day: ApiMarketDay): MarketDay {
  return day === "tomorrow" ? "tomorrow" : "today";
}

function publicModel(row: ModelRow): PublicModelRow {
  return {
    id: row.id,
    label: row.label,
    primary: row.role === "primary",
    role: row.role,
    available: row.available,
    raw_max_c: row.rawMaxC,
    raw_min_c: row.rawMinC,
    corrected_max_c: row.correctedMaxC,
    bias_c: row.correctionC,
    bias_n: row.correctionN,
    ...(row.status ? { status: row.status, weight: row.weight ?? null } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.run
      ? {
          run: {
            init_at: row.run.initAt,
            init_z: row.run.initZ,
            available_at: row.run.availableAt,
            nest: row.run.nest,
          },
        }
      : {}),
  };
}

function publicWu(wu: WuPayload): PublicWu {
  return {
    ok: wu.ok,
    ...(wu.error ? { error: wu.error } : {}),
    station_id: wu.stationId,
    daily_max_c: wu.ok ? (wu.dailyMaxC ?? null) : null,
    predicted_high_c: wu.ok ? (wu.predictedHighC ?? null) : null,
    low_c: wu.ok ? (wu.lowC ?? null) : null,
    current_temp_c: wu.ok ? (wu.currentTempC ?? null) : null,
    stale: wu.stale,
    url: wu.forecastUrl,
  };
}

function publicMetar(metar: MetarPayload): PublicMetar {
  return {
    ok: metar.ok,
    ...(metar.error ? { error: metar.error } : {}),
    running_max_c: metar.ok ? (metar.runningMaxC ?? null) : null,
    resolution_max_c: metar.ok ? (metar.resolutionMaxC ?? null) : null,
    running_max_at: metar.ok ? (metar.runningMaxAt ?? null) : null,
    latest_temp_c: metar.ok ? (metar.latest?.tempC ?? null) : null,
    stale: metar.stale,
  };
}

function publicSynoptic(synoptic: SynopticPayload): PublicSynoptic {
  return {
    ok: synoptic.ok,
    configured: synoptic.configured,
    ...(synoptic.error ? { error: synoptic.error } : {}),
    resolution_max: synoptic.ok ? synoptic.resolutionMax : null,
    unit: synoptic.unit,
    stale: synoptic.stale,
  };
}

function publicPws(pws: PwsPayload, metar: MetarPayload): PublicPws[] {
  const metarC = metar.ok ? (metar.latest?.tempC ?? null) : null;
  return pws.stations.map((p) => ({
    id: p.id,
    source: p.source,
    name: p.name,
    url: p.url,
    ok: p.ok,
    ...(p.error ? { error: p.error } : {}),
    temp_c: p.tempC,
    observed_at: p.obsTimeIso,
    delta_vs_metar_c:
      p.tempC != null && metarC != null
        ? Math.round((p.tempC - metarC) * 10) / 10
        : null,
  }));
}

function publicHusky(husky: HuskyPayload): PublicHusky {
  return {
    ok: husky.ok,
    ...(husky.error ? { error: husky.error } : {}),
    daily_max_c: husky.ok ? (husky.dailyMaxC ?? null) : null,
    local_date: husky.localDate ?? null,
    stale: husky.stale,
    url: husky.url,
  };
}

export function publicStationPayload(
  data: StationPayload,
  opts: { day: ApiMarketDay; dateRequested: string },
): PublicStationResponse {
  return {
    icao: data.station.icao,
    city: data.station.city,
    name: data.station.name,
    region: data.station.region,
    timezone: data.station.timezone,
    unit: data.station.defaultUnit,
    day: opts.day,
    market_date: data.marketDate,
    date_requested: opts.dateRequested,
    primary_model: data.station.primary,
    primary_models: data.station.primaryModels,
    models: data.forecast.models.map(publicModel),
    consensus_raw_c: data.forecast.consensusRawC,
    consensus_corrected_c: data.forecast.consensusCorrectedC,
    ensemble: data.forecast.ensemble
      ? {
          ok: data.forecast.ensemble.ok,
          ...(data.forecast.ensemble.error ? { error: data.forecast.ensemble.error } : {}),
          lead: data.forecast.ensemble.lead,
          recipe_date: data.forecast.ensemble.recipeDate,
          generated_utc: data.forecast.ensemble.generatedUtc,
          blend_c: data.forecast.ensemble.blendC,
          mu_c: data.forecast.ensemble.mu,
          sd_c: data.forecast.ensemble.sd,
          most_likely_c: data.forecast.ensemble.kTop,
          most_likely_p: data.forecast.ensemble.pTop,
          range80_c: data.forecast.ensemble.range80,
          probs: data.forecast.ensemble.probs,
          truncated_at_c: data.forecast.ensemble.truncatedAt,
        }
      : null,
    polymarket_slug:
      data.polymarket.slug ||
      polymarketEventSlug(data.station.icao, data.marketDate) ||
      null,
    polymarket_url:
      data.polymarket.url ||
      polymarketEventUrl(data.station.icao, data.marketDate) ||
      null,
    wunderground: publicWu(data.wu),
    husky: publicHusky(data.husky),
    metar: publicMetar(data.metar),
    synoptic: publicSynoptic(data.synoptic),
    pws: publicPws(data.pws, data.metar),
  };
}

function truthyParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

export async function handleStationApiRequest(
  request: Request,
  icao: string,
  dayFromPath?: string,
): Promise<Response> {
  const station = getStation(icao);
  if (!station) {
    return Response.json(
      { error: `Unknown station ${icao}. Use a configured ICAO.` },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const day = parseApiDay(dayFromPath ?? url.searchParams.get("day"));
  if (!day) {
    return Response.json(
      { error: "Invalid day. Use now or tomorrow." },
      { status: 400 },
    );
  }

  const dateRequested = new Date().toISOString();
  const compareAll = truthyParam(url.searchParams.get("compareAll"));
  const fresh = truthyParam(url.searchParams.get("fresh"));

  try {
    const payload = await assembleStation(station.icao, toMarketDay(day), compareAll, { fresh });
    return Response.json(
      publicStationPayload(payload, { day, dateRequested }),
      {
        headers: {
          "Cache-Control": "private, max-age=30",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to assemble station",
      },
      { status: 502 },
    );
  }
}
