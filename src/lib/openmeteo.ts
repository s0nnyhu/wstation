import type { Station } from "./types";
import { cacheGet, cacheSet, FORECAST_TTL_MS, FRESH_MIN_AGE_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import { compareAllFor, uniqueStrings } from "./models";

export interface OpenMeteoRaw {
  latitude: number;
  longitude: number;
  generationtime_ms?: number;
  utc_offset_seconds?: number;
  timezone: string;
  hourly?: Record<string, Array<string | number | null>>;
  daily?: Record<string, Array<string | number | null>>;
  hourly_units?: Record<string, string>;
  daily_units?: Record<string, string>;
}

export interface ForecastFetch {
  data: OpenMeteoRaw;
  models: string[];
  fetchedAt: string;
  stale: boolean;
  staleReason?: string;
  requestUrl: string;
}

export function openMeteoBase(): string {
  return (
    process.env.OPEN_METEO_BASE_URL?.replace(/\/$/, "") ??
    "https://api.open-meteo.com"
  );
}

/**
 * Models of the display request (hourly drivers, chart). For ensemble stations
 * only the reference model: the ensemble temperatures come from
 * fetchEnsembleTemps.
 */
export function modelsForRequest(
  station: Station,
  compareAll: boolean,
): string[] {
  if (station.ensemble) return [station.primary];
  const defaults = uniqueStrings([
    ...station.primaryModels,
    station.primary,
    ...(station.shortRange ? [station.shortRange] : []),
    ...(station.h6Model ? [station.h6Model] : []),
    ...station.backups,
  ]);
  if (!compareAll) return defaults;
  return uniqueStrings([
    ...compareAllFor(station.region),
    ...defaults,
    ...station.domainExtras,
  ]);
}

export function seriesKey(
  base: string,
  modelId: string,
  modelCount: number,
): string {
  return modelCount === 1 ? base : `${base}_${modelId}`;
}

export function numericSeries(
  block: Record<string, Array<string | number | null>> | undefined,
  key: string,
): Array<number | null> {
  const raw = block?.[key];
  if (!raw) return [];
  return raw.map((v) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });
}

export function stringSeries(
  block: Record<string, Array<string | number | null>> | undefined,
  key: string,
): string[] {
  const raw = block?.[key];
  if (!raw) return [];
  return raw.map((v) => String(v));
}

export async function fetchOpenMeteoForecast(
  station: Station,
  compareAll: boolean,
  opts: { fresh?: boolean } = {},
): Promise<ForecastFetch> {
  const models = modelsForRequest(station, compareAll);
  const cacheKey = `om:v2:${station.icao}:${models.join(",")}`;
  const cached = cacheGet<ForecastFetch>(cacheKey, FORECAST_TTL_MS);

  if (cached?.fresh && !(opts.fresh && cached.ageMs > FRESH_MIN_AGE_MS)) {
    return { ...cached.value, stale: false };
  }

  const url = new URL(`${openMeteoBase()}/v1/forecast`);
  url.searchParams.set("latitude", String(station.lat));
  url.searchParams.set("longitude", String(station.lon));
  url.searchParams.set("timezone", station.timezone);
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "precipitation_probability",
      "cloud_cover",
      "weather_code",
      "precipitation",
      "rain",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
      "shortwave_radiation",
      "relative_humidity_2m",
    ].join(","),
  );
  url.searchParams.set("models", models.join(","));

  const apiKey = process.env.OPEN_METEO_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetchWithBackoff(
      url.toString(),
      { headers: { Accept: "application/json" } },
      { timeoutMs: 12_000, retries: 1 },
    );
    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    const data = (await res.json()) as OpenMeteoRaw;
    const payload: ForecastFetch = {
      data,
      models,
      fetchedAt: new Date().toISOString(),
      stale: false,
      requestUrl: stripKey(url),
    };
    cacheSet(cacheKey, payload);
    return payload;
  } catch (error) {
    if (cached) {
      return {
        ...cached.value,
        stale: true,
        staleReason:
          error instanceof Error
            ? `Serving cached forecast (${error.message})`
            : "Serving cached forecast after upstream failure",
      };
    }
    throw error;
  }
}

export interface EnsembleTemps {
  /** Hourly instants, UTC epoch seconds. */
  times: number[];
  temps: Record<string, Array<number | null>>;
  models: string[];
  fetchedAt: string;
  stale: boolean;
  staleReason?: string;
  requestUrl: string;
}

/**
 * Hourly 2 m temperature of every ensemble model, requested exactly like the
 * weather-analysis pipeline (station timezone, past day + 4 days, unix time)
 * so the raw daily max is computed the same way.
 */
export async function fetchEnsembleTemps(
  station: Station,
  opts: { fresh?: boolean } = {},
): Promise<EnsembleTemps> {
  const models = station.ensemble?.models ?? [];
  const cacheKey = `om-ens:v1:${station.icao}:${models.join(",")}`;
  const cached = cacheGet<EnsembleTemps>(cacheKey, FORECAST_TTL_MS);
  if (cached?.fresh && !(opts.fresh && cached.ageMs > FRESH_MIN_AGE_MS)) {
    return { ...cached.value, stale: false };
  }
  const url = new URL(`${openMeteoBase()}/v1/forecast`);
  url.searchParams.set("latitude", String(station.lat));
  url.searchParams.set("longitude", String(station.lon));
  url.searchParams.set("timezone", station.timezone);
  url.searchParams.set("hourly", "temperature_2m");
  url.searchParams.set("models", models.join(","));
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("temperature_unit", "celsius");
  const apiKey = process.env.OPEN_METEO_API_KEY;
  if (apiKey) url.searchParams.set("apikey", apiKey);
  try {
    const res = await fetchWithBackoff(
      url.toString(),
      { headers: { Accept: "application/json" } },
      { timeoutMs: 12_000, retries: 1 },
    );
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = (await res.json()) as OpenMeteoRaw;
    const times = numericSeries(data.hourly, "time").map((t) => t ?? NaN);
    const temps: Record<string, Array<number | null>> = {};
    for (const id of models) {
      temps[id] = numericSeries(data.hourly, seriesKey("temperature_2m", id, models.length));
    }
    const payload: EnsembleTemps = {
      times,
      temps,
      models,
      fetchedAt: new Date().toISOString(),
      stale: false,
      requestUrl: stripKey(url),
    };
    cacheSet(cacheKey, payload);
    return payload;
  } catch (error) {
    if (cached) {
      return {
        ...cached.value,
        stale: true,
        staleReason:
          error instanceof Error
            ? `Serving cached ensemble forecast (${error.message})`
            : "Serving cached ensemble forecast after upstream failure",
      };
    }
    throw error;
  }
}

function stripKey(url: URL): string {
  const copy = new URL(url.toString());
  copy.searchParams.delete("apikey");
  return copy.toString();
}
