import { cacheGet, cacheSet, STALE_MAX_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import type { MetarLatest, MetarPayload, MetarStripPoint } from "./types";
import { iconFromMetar, parseMetarSky } from "./weatherIcon";

interface AviationWeatherMetar {
  icaoId?: string;
  temp?: number | null;
  dewp?: number | null;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  obsTime?: number;
  reportTime?: string;
  rawOb?: string;
  name?: string;
  visib?: string | number | null;
  altim?: number | null;
  cover?: string | null;
}

const USER_AGENT = "WStation/0.1 (local Polymarket weather dashboard)";

function metarBase(): string {
  return (
    process.env.METAR_BASE_URL?.replace(/\/$/, "") ??
    "https://aviationweather.gov/api/data/metar"
  );
}

/** Tenths from the remarks T-group, e.g. `T01890156` → 18.9. */
export function parseTGroup(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/\bT([01])(\d{3})[01]\d{3}\b/);
  if (!match) return null;
  const sign = match[1] === "1" ? -1 : 1;
  return (sign * Number(match[2])) / 10;
}

/** Integer °C from the body temperature/dewpoint token, e.g. `19/12` or `M03/M07`. */
export function parseMetarTempToken(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/\s(M)?(\d{2})\/(M)?(\d{2}|\/\/)(?:\s|$)/);
  if (!match) return null;
  const value = Number(match[2]);
  return match[1] === "M" ? -value : value;
}

function observationTempC(obs: AviationWeatherMetar): number | null {
  const tGroup = parseTGroup(obs.rawOb);
  if (tGroup != null) return tGroup;
  if (typeof obs.temp === "number" && Number.isFinite(obs.temp))
    return obs.temp;
  return parseMetarTempToken(obs.rawOb);
}

function observationBodyC(obs: AviationWeatherMetar): number | null {
  const body = parseMetarTempToken(obs.rawOb);
  if (body != null) return body;
  if (typeof obs.temp === "number" && Number.isFinite(obs.temp)) {
    return Math.round(obs.temp);
  }
  return null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMetarWind(raw: string | undefined): {
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
} {
  if (!raw) {
    return { windDirDeg: null, windSpeedKt: null, windGustKt: null };
  }
  const match = raw.match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (!match) {
    return { windDirDeg: null, windSpeedKt: null, windGustKt: null };
  }
  return {
    windDirDeg: match[1] === "VRB" ? null : Number(match[1]),
    windSpeedKt: Number(match[2]),
    windGustKt: match[3] != null ? Number(match[3]) : null,
  };
}

function observationWind(obs: AviationWeatherMetar): {
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
} {
  const fromRaw = parseMetarWind(obs.rawOb);
  const apiDir =
    typeof obs.wdir === "number" ? finiteOrNull(obs.wdir) : fromRaw.windDirDeg;
  return {
    windDirDeg: apiDir,
    windSpeedKt: finiteOrNull(obs.wspd) ?? fromRaw.windSpeedKt,
    windGustKt: finiteOrNull(obs.wgst) ?? fromRaw.windGustKt,
  };
}

function observationIso(obs: AviationWeatherMetar): string | null {
  if (typeof obs.obsTime === "number") {
    return new Date(obs.obsTime * 1000).toISOString();
  }
  if (obs.reportTime) {
    const parsed = new Date(
      obs.reportTime.endsWith("Z") ? obs.reportTime : `${obs.reportTime}Z`,
    );
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function rhFromTempDew(
  tempC: number | null | undefined,
  dewpointC: number | null | undefined,
): number | null {
  if (tempC == null || dewpointC == null) return null;
  const magnus = (t: number) => 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  const rh = (100 * magnus(dewpointC)) / magnus(tempC);
  if (!Number.isFinite(rh)) return null;
  return Math.max(0, Math.min(100, Math.round(rh)));
}

function visibilityLabel(visib: string | number | null | undefined, raw?: string): string | null {
  if (typeof visib === "number" && Number.isFinite(visib)) {
    return visib >= 6 ? "6+" : String(visib);
  }
  if (typeof visib === "string" && visib.trim()) return visib.trim();
  if (raw && /\bCAVOK\b/.test(raw)) return "CAVOK";
  const q = raw?.match(/\b(\d{4})\b/);
  if (q) return `${q[1]} m`;
  return null;
}

export function zonedDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Observations are cached separately so they never leak into API responses. */
function obsCacheKey(icao: string): string {
  return `metar:obs:v1:${icao}`;
}

export async function fetchMetar(
  icao: string,
  timezone: string,
  marketDate: string,
  opts: { fresh?: boolean } = {},
): Promise<MetarPayload> {
  void opts;
  // Always hit Aviation Weather. The previous 2-minute TTL kept serving the
  // prior METAR after the next one was already published. The stored payload
  // is only a fallback when that request fails.
  const cacheKey = `metar:v4:${icao}`;
  const cached = cacheGet<MetarPayload>(cacheKey, STALE_MAX_MS);
  const cachedObs = cacheGet<MetarLatest[]>(obsCacheKey(icao), STALE_MAX_MS);

  const url = new URL(metarBase());
  url.searchParams.set("ids", icao);
  url.searchParams.set("format", "json");
  url.searchParams.set("hours", "36");

  try {
    const res = await fetchWithBackoff(
      url.toString(),
      { headers: { Accept: "application/json", "User-Agent": USER_AGENT } },
      { timeoutMs: 8_000, retries: 1 },
    );
    if (!res.ok) {
      throw new Error(`METAR HTTP ${res.status}`);
    }
    const json = (await res.json()) as AviationWeatherMetar[];
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error(`No METAR returned for ${icao}`);
    }

    const observations: MetarLatest[] = [];
    for (const obs of json) {
      const tempC = observationTempC(obs);
      const observedAt = observationIso(obs);
      if (tempC == null || !observedAt) continue;
      const dewpointC = typeof obs.dewp === "number" ? obs.dewp : null;
      const raw = obs.rawOb ?? "";
      const sky = parseMetarSky(raw, obs.cover);
      observations.push({
        tempC,
        tempBodyC: observationBodyC(obs),
        dewpointC,
        observedAt,
        raw,
        name: obs.name,
        visibility: visibilityLabel(obs.visib, raw),
        altimeterHPa: finiteOrNull(obs.altim),
        sky,
        humidityPct: rhFromTempDew(tempC, dewpointC),
        icon: iconFromMetar(raw, obs.cover),
        ...observationWind(obs),
      });
    }
    observations.sort(
      (a, b) =>
        new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
    );

    if (observations.length === 0) {
      throw new Error(`METAR for ${icao} had no usable temperatures`);
    }

    const latest = observations[0];
    const recent = observations.slice(0, 4);
    const declining =
      recent.length >= 3 &&
      recent[0].tempC < recent[1].tempC &&
      recent[1].tempC <= recent[2].tempC + 0.2;

    const payload: MetarPayload = {
      ok: true,
      latest,
      observationCount: observations.length,
      declining,
      fetchedAt: new Date().toISOString(),
      stale: false,
      ...runningMax(observations, timezone, marketDate),
      observations: stripForDay(observations, timezone, marketDate),
    };
    cacheSet(cacheKey, payload);
    cacheSet(obsCacheKey(icao), observations);
    return payload;
  } catch (error) {
    if (cached) {
      return withRunning(
        {
          ...cached.value,
          error:
            error instanceof Error
              ? `Serving cached METAR (${error.message})`
              : "Serving cached METAR after upstream failure",
        },
        cachedObs?.value,
        timezone,
        marketDate,
        true,
      );
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "METAR fetch failed",
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }
}

/**
 * Running maxes for the market local day:
 * - `runningMaxC`: physical max (tenths when the T-group is present)
 * - `resolutionMaxC`: max of the integer body values, which is what the
 *   NOAA timeseries page rounds from (ASOS 5-minute obs are integer °C).
 */
export function runningMax(
  observations: MetarLatest[],
  timezone: string,
  marketDate: string,
): {
  runningMaxC: number | null;
  runningMaxAt: string | null;
  resolutionMaxC: number | null;
} {
  let max: number | null = null;
  let at: string | null = null;
  let body: number | null = null;
  for (const obs of observations) {
    if (zonedDate(obs.observedAt, timezone) !== marketDate) continue;
    if (max == null || obs.tempC > max) {
      max = obs.tempC;
      at = obs.observedAt;
    }
    const b = obs.tempBodyC ?? Math.round(obs.tempC);
    if (body == null || b > body) body = b;
  }
  return { runningMaxC: max, runningMaxAt: at, resolutionMaxC: body };
}

function stripForDay(
  observations: MetarLatest[],
  timezone: string,
  marketDate: string,
): MetarStripPoint[] {
  const day = observations
    .filter((o) => zonedDate(o.observedAt, timezone) === marketDate)
    .sort(
      (a, b) =>
        new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
    );
  const out: MetarStripPoint[] = [];
  let lastMs = 0;
  for (const o of day) {
    const ms = new Date(o.observedAt).getTime();
    const isLast = o === day[day.length - 1];
    if (!isLast && lastMs && ms - lastMs < 28 * 60_000) continue;
    out.push({
      at: o.observedAt,
      tempC: o.tempC,
      sky: o.sky,
      icon: o.icon ?? iconFromMetar(o.raw),
    });
    lastMs = ms;
    if (out.length >= 48) break;
  }
  return out;
}

function withRunning(
  payload: MetarPayload,
  observations: MetarLatest[] | undefined,
  timezone: string,
  marketDate: string,
  stale: boolean,
): MetarPayload {
  if (!observations) {
    return { ...payload, stale };
  }
  return {
    ...payload,
    stale,
    ...runningMax(observations, timezone, marketDate),
    observations: stripForDay(observations, timezone, marketDate),
  };
}
