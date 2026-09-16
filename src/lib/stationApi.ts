import { assembleStation } from "./assemble";
import { parseBiasGrain, parseSeasonMode } from "./bias";
import { getStation, polymarketEventSlug } from "@/config/stations";
import type {
  BiasResolution,
  HuskyPayload,
  MarketDay,
  ModelRow,
  StationPayload,
  TempUnit,
  WuPayload,
} from "./types";

export type ApiMarketDay = "now" | "tomorrow";

export interface PublicModelBias {
  season: string;
  month?: string;
  source: BiasResolution["source"];
  unit: TempUnit;
  bias_native: number | null;
  bias_c: number | null;
  n: number;
  mae?: number;
}

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
  bias_c: number | null;
  bias: PublicModelBias;
  note?: string;
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

export interface PublicHusky {
  ok: boolean;
  error?: string;
  daily_max_c: number | null;
  local_date?: string | null;
  stale: boolean;
  url: string;
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
  primary_model: string;
  primary_models: string[];
  models: PublicModelRow[];
  consensus_raw_c: number | null;
  consensus_corrected_c: number | null;
  /** Polymarket event slug for the market local date, e.g. highest-temperature-in-munich-on-september-16-2026. */
  polymarket_slug: string | null;
  wunderground: PublicWu;
  husky: PublicHusky;
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

function publicBias(bias: BiasResolution): PublicModelBias {
  return {
    season: bias.season,
    ...(bias.month ? { month: bias.month } : {}),
    source: bias.source,
    unit: bias.unit,
    bias_native: bias.biasNative,
    bias_c: bias.source === "none" ? null : bias.biasC,
    n: bias.n,
    ...(bias.mae != null ? { mae: bias.mae } : {}),
  };
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
    bias_c: row.bias.source === "none" ? null : row.biasC,
    bias: publicBias(row.bias),
    ...(row.note ? { note: row.note } : {}),
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
    polymarket_slug:
      data.polymarket.slug ||
      polymarketEventSlug(data.station.icao, data.marketDate) ||
      null,
    wunderground: publicWu(data.wu),
    husky: publicHusky(data.husky),
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
    const payload = await assembleStation(station.icao, toMarketDay(day), compareAll, {
      fresh,
      seasonMode: parseSeasonMode(url.searchParams.get("season")),
      biasGrain: parseBiasGrain(url.searchParams.get("grain")),
    });
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
