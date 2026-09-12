import { cacheGet, cacheSet, FRESH_MIN_AGE_MS, SYNOPTIC_TTL_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import { zonedDate } from "./metar";
import type { SynopticPayload, TempUnit } from "./types";
import { convertTemp } from "./units";

const USER_AGENT = "WStation/0.1 (local Polymarket weather dashboard)";
const SYNOPTIC_BASE = "https://api.synopticdata.com/v2/stations/timeseries";

interface SynopticSeries {
  times: string[];
  tempsC: Array<number | null>;
}

interface SynopticResponse {
  SUMMARY?: { RESPONSE_CODE?: number; RESPONSE_MESSAGE?: string };
  STATION?: Array<{
    STID?: string;
    OBSERVATIONS?: {
      date_time?: string[];
      air_temp_set_1?: Array<number | null>;
    };
  }>;
}

function token(): string | undefined {
  return process.env.SYNOPTIC_TOKEN?.trim() || undefined;
}

function empty(unit: TempUnit, extra: Partial<SynopticPayload> = {}): SynopticPayload {
  return {
    ok: false,
    configured: !!token(),
    resolutionMax: null,
    resolutionMaxAt: null,
    maxC: null,
    latestC: null,
    latestAt: null,
    observationCount: 0,
    unit,
    fetchedAt: new Date().toISOString(),
    stale: false,
    ...extra,
  };
}

export function synopticFailedPayload(unit: TempUnit, error: unknown): SynopticPayload {
  return empty(unit, {
    error: error instanceof Error ? error.message : "Synoptic fetch failed",
  });
}

/**
 * Reproduce the NOAA WRH timeseries page: it renders
 * `Math.round(air_temp_set_1)` in the requested unit, and Polymarket takes the
 * highest of those rows for the local day.
 */
export function noaaStyleMax(
  series: SynopticSeries,
  timezone: string,
  marketDate: string,
  unit: TempUnit,
): Pick<
  SynopticPayload,
  "resolutionMax" | "resolutionMaxAt" | "maxC" | "latestC" | "latestAt" | "observationCount"
> {
  let resolutionMax: number | null = null;
  let resolutionMaxAt: string | null = null;
  let maxC: number | null = null;
  let latestC: number | null = null;
  let latestAt: string | null = null;
  let count = 0;
  for (let i = 0; i < series.times.length; i++) {
    const c = series.tempsC[i];
    const t = series.times[i];
    if (c == null || !Number.isFinite(c) || !t) continue;
    if (latestAt == null || t > latestAt) {
      latestAt = t;
      latestC = c;
    }
    if (zonedDate(t, timezone) !== marketDate) continue;
    count++;
    const rounded = Math.round(convertTemp(c, unit));
    if (resolutionMax == null || rounded > resolutionMax) {
      resolutionMax = rounded;
      resolutionMaxAt = t;
    }
    if (maxC == null || c > maxC) maxC = c;
  }
  return {
    resolutionMax,
    resolutionMaxAt,
    maxC,
    latestC,
    latestAt,
    observationCount: count,
  };
}

export async function fetchSynoptic(
  icao: string,
  timezone: string,
  marketDate: string,
  unit: TempUnit,
  opts: { fresh?: boolean } = {},
): Promise<SynopticPayload> {
  const key = token();
  if (!key) return empty(unit, { error: "SYNOPTIC_TOKEN not set" });

  const stid = icao.trim().toUpperCase();
  const cacheKey = `synoptic:${stid}`;
  const cached = cacheGet<SynopticSeries>(cacheKey, SYNOPTIC_TTL_MS);
  if (cached?.fresh && !(opts.fresh && cached.ageMs > FRESH_MIN_AGE_MS)) {
    return {
      ...empty(unit, { ok: true }),
      ...noaaStyleMax(cached.value, timezone, marketDate, unit),
    };
  }

  try {
    const url = new URL(SYNOPTIC_BASE);
    url.searchParams.set("STID", stid);
    url.searchParams.set("vars", "air_temp");
    url.searchParams.set("units", "temp|C");
    url.searchParams.set("recent", "1500");
    url.searchParams.set("obtimezone", "utc");
    url.searchParams.set("token", key);
    const res = await fetchWithBackoff(
      url.toString(),
      { headers: { Accept: "application/json", "User-Agent": USER_AGENT } },
      { timeoutMs: 8_000, retries: 1 },
    );
    if (!res.ok) throw new Error(`Synoptic HTTP ${res.status}`);
    const json = (await res.json()) as SynopticResponse;
    if (json.SUMMARY?.RESPONSE_CODE !== 1) {
      throw new Error(`Synoptic: ${json.SUMMARY?.RESPONSE_MESSAGE ?? "bad response"}`);
    }
    const obs = json.STATION?.[0]?.OBSERVATIONS;
    const series: SynopticSeries = {
      times: obs?.date_time ?? [],
      tempsC: obs?.air_temp_set_1 ?? [],
    };
    if (series.times.length === 0) throw new Error(`Synoptic: no observations for ${stid}`);
    cacheSet(cacheKey, series);
    return {
      ...empty(unit, { ok: true }),
      ...noaaStyleMax(series, timezone, marketDate, unit),
    };
  } catch (error) {
    if (cached) {
      return {
        ...empty(unit, {
          ok: true,
          stale: true,
          error:
            error instanceof Error
              ? `Cached Synoptic (${error.message})`
              : "Cached Synoptic after upstream failure",
        }),
        ...noaaStyleMax(cached.value, timezone, marketDate, unit),
      };
    }
    return synopticFailedPayload(unit, error);
  }
}
