import { cacheGet, cacheSet, FRESH_MIN_AGE_MS, HUSKY_TTL_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import type { HuskyPayload } from "./types";

const USER_AGENT = "WStation/0.1 (local Polymarket weather dashboard)";

export function huskyStationUrl(icao: string): string {
  return `https://huskyweather.com/station/${icao.trim().toUpperCase()}`;
}

function emptyHusky(icao: string, extra: Partial<HuskyPayload> = {}): HuskyPayload {
  return {
    ok: extra.ok ?? false,
    dailyMaxC: extra.dailyMaxC ?? null,
    fetchedAt: extra.fetchedAt ?? new Date().toISOString(),
    stale: extra.stale ?? false,
    url: huskyStationUrl(icao),
    ...extra,
  };
}

export function huskyFailedPayload(icao: string, error: unknown): HuskyPayload {
  return emptyHusky(icao, {
    ok: false,
    error: error instanceof Error ? error.message : "HuskyWeather fetch failed",
  });
}

export async function fetchHuskyConsensus(
  icao: string,
  marketDate: string,
  opts: { fresh?: boolean } = {},
): Promise<HuskyPayload> {
  const code = icao.trim().toUpperCase();
  const cacheKey = `husky:${code}`;
  const cached = cacheGet<HuskyPayload>(cacheKey, HUSKY_TTL_MS);
  if (cached?.fresh && !(opts.fresh && cached.ageMs > FRESH_MIN_AGE_MS)) {
    return { ...cached.value, dailyMaxC: maxForDate(cached.value, marketDate) };
  }

  try {
    const url = `https://huskyweather.com/api/station/${code}/snapshot`;
    const res = await fetchWithBackoff(
      url,
      { headers: { Accept: "application/json", "User-Agent": USER_AGENT } },
      { timeoutMs: 6_000, retries: 0 },
    );
    if (!res.ok) throw new Error(`Husky HTTP ${res.status}`);
    const json = (await res.json()) as {
      consensus_c?: number | null;
      forecast?: { consensus_c?: number | null };
      local_time?: string;
    };
    const consensus =
      (typeof json.forecast?.consensus_c === "number"
        ? json.forecast.consensus_c
        : null) ??
      (typeof json.consensus_c === "number" ? json.consensus_c : null);
    const localDate = json.local_time?.slice(0, 10) ?? null;
    const payload: HuskyPayload = {
      ok: true,
      dailyMaxC: consensus,
      localDate,
      fetchedAt: new Date().toISOString(),
      stale: false,
      url: huskyStationUrl(code),
    };
    cacheSet(cacheKey, payload);
    return { ...payload, dailyMaxC: maxForDate(payload, marketDate) };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "HuskyWeather fetch failed";
    if (cached) {
      return {
        ...cached.value,
        dailyMaxC: maxForDate(cached.value, marketDate),
        stale: true,
        error: `Cached Husky (${message})`,
      };
    }
    return huskyFailedPayload(code, error);
  }
}

function maxForDate(payload: HuskyPayload, marketDate: string): number | null {
  if (payload.localDate && payload.localDate !== marketDate) return null;
  return payload.dailyMaxC ?? null;
}
