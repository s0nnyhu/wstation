import { otherSourceUrlsFor } from "@/config/pws";
import { cacheGet, cacheSet } from "./cache";
import { fetchWithBackoff } from "./http";
import { zonedDate } from "./metar";
import type { OtherSourceForecast, OtherSourcesPayload } from "./types";

/**
 * Forecasts from weather websites that have no public API, read the way
 * their own pages read them. Shown as "Other sources": the predicted max for
 * the market day, plus hourly temperatures when the site provides them.
 * These are internal site endpoints and may break without notice.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Sites update hourly at best; no need to hit them on every 15 s tick. */
const FORECAST_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const IMGW_CONFIG_TTL_MS = 12 * 60 * 60 * 1000;

/** Source-agnostic forecast: hourly points (UTC ISO) and daily maxima by local date. */
export interface RawForecast {
  name: string | null;
  hourly: Array<{ at: string; tempC: number }>;
  dailyMaxC: Record<string, number>;
}

async function getResponse(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await fetchWithBackoff(
    url,
    { headers: { "User-Agent": BROWSER_UA, ...headers } },
    { timeoutMs: 8_000, retries: 0 },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Market-day view of a raw forecast. */
export function forMarketDay(
  raw: RawForecast,
  marketDate: string,
  timeZone: string,
): Pick<OtherSourceForecast, "maxC" | "maxScope" | "hourly"> {
  const hourly = raw.hourly.filter((p) => zonedDate(p.at, timeZone) === marketDate);
  const daily = raw.dailyMaxC[marketDate];
  if (daily != null) return { maxC: daily, maxScope: "day", hourly };
  if (hourly.length === 0) return { maxC: null, maxScope: "day", hourly };
  // Without a daily max, a full day of hours is the day; fewer is what is left of it.
  return {
    maxC: Math.max(...hourly.map((p) => p.tempC)),
    maxScope: hourly.length >= 24 ? "day" : "remaining",
    hourly,
  };
}

// ---- meteofrance.com ------------------------------------------------------

interface MfSession {
  token: string;
  lat: string;
  lon: string;
  id: string;
  name: string | null;
}

const rot13 = (s: string) =>
  s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
  });

/** The page sets an `mfsession` cookie; its rot13 is the API bearer token. */
async function meteoFranceSession(pageUrl: string, fresh: boolean): Promise<MfSession> {
  const key = `other:mf:session:${pageUrl}`;
  const hit = cacheGet<MfSession>(key, SESSION_TTL_MS);
  if (hit?.fresh && !fresh) return hit.value;
  const res = await getResponse(pageUrl, { Accept: "text/html" });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.match(/^mfsession=([^;]+)/)?.[1])
    .find(Boolean);
  if (!cookie) throw new Error("meteofrance.com session cookie missing");
  const html = await res.text();
  const json = html.match(/data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/)?.[1];
  const poi = json ? JSON.parse(json).mf_barre_fav_current_poi : null;
  if (!poi?.lat || !poi?.lng || !poi?.id) throw new Error("meteofrance.com location not found");
  const session = {
    token: rot13(decodeURIComponent(cookie)),
    lat: String(poi.lat),
    lon: String(poi.lng),
    id: String(poi.id),
    name: poi.name ?? null,
  };
  cacheSet(key, session);
  return session;
}

interface MfForecastResponse {
  properties?: {
    forecast?: Array<{ time?: string; T?: number | null }>;
    daily_forecast?: Array<{ time?: string; T_max?: number | null }>;
  };
}

export function parseMeteoFranceForecast(body: MfForecastResponse, name: string | null): RawForecast {
  const p = body.properties ?? {};
  const hourly = (p.forecast ?? [])
    .filter((f) => f.time && typeof f.T === "number" && Number.isFinite(f.T))
    .map((f) => ({ at: new Date(f.time!).toISOString(), tempC: f.T! }));
  const dailyMaxC: Record<string, number> = {};
  for (const d of p.daily_forecast ?? []) {
    // Daily entries are stamped 00:00Z on the local date they describe.
    if (d.time && typeof d.T_max === "number") dailyMaxC[d.time.slice(0, 10)] = d.T_max;
  }
  return { name, hourly, dailyMaxC };
}

async function fetchMeteoFranceCom(pageUrl: string, fresh: boolean): Promise<RawForecast> {
  const call = async (session: MfSession) =>
    getResponse(
      `https://rwg.meteofrance.com/internet2018client/2.0/forecast?lat=${session.lat}&lon=${session.lon}&id=${session.id}`,
      { Accept: "application/json", Authorization: `Bearer ${session.token}` },
    );
  let session = await meteoFranceSession(pageUrl, fresh);
  let res: Response;
  try {
    res = await call(session);
  } catch {
    // Expired session: take a fresh cookie once.
    session = await meteoFranceSession(pageUrl, true);
    res = await call(session);
  }
  return parseMeteoFranceForecast((await res.json()) as MfForecastResponse, session.name);
}

// ---- IMGW (meteo.imgw.pl) -------------------------------------------------

interface ImgwConfig {
  base: string;
  token: string;
}

/** The site's API base and token are build-time constants in its main bundle. */
async function imgwConfig(fresh: boolean): Promise<ImgwConfig> {
  const key = "other:imgw:config";
  const hit = cacheGet<ImgwConfig>(key, IMGW_CONFIG_TTL_MS);
  if (hit?.fresh && !fresh) return hit.value;
  const html = await (await getResponse("https://meteo.imgw.pl/", { Accept: "text/html" })).text();
  const main = html.match(/src="(main\.[0-9a-f]+\.js)"/)?.[1];
  if (!main) throw new Error("meteo.imgw.pl bundle not found");
  const js = await (await getResponse(`https://meteo.imgw.pl/${main}`, { Accept: "*/*" })).text();
  const read = (k: string) => js.match(new RegExp(`${k}:"([^"]+)"`))?.[1];
  const apiUrl = read("apiUrl");
  const apiSubUrl = read("apiSubUrl");
  const token = read("apiToken");
  if (!apiUrl || !apiSubUrl || !token) throw new Error("meteo.imgw.pl API config not found");
  const config = { base: `${apiUrl}/${apiSubUrl}`, token };
  cacheSet(key, config);
  return config;
}

interface ImgwForecastResponse {
  data?: {
    Valid?: boolean;
    Data?: Array<{ Date?: string; Temperature?: string | number }>;
    Day_Night_Data?: Array<{ Date?: string; isDay?: boolean; Temp_Max?: string | number }>;
  };
}

const kelvinToC = (v: string | number | undefined) => {
  const k = Number(v);
  return Number.isFinite(k) ? round1(k - 273.15) : null;
};

export function parseImgwForecast(body: ImgwForecastResponse): RawForecast {
  const d = body.data;
  if (!d?.Valid) throw new Error("meteo.imgw.pl forecast not valid for this point");
  const hourly: RawForecast["hourly"] = [];
  for (const row of d.Data ?? []) {
    // The first hours are a 10-minute nowcast; keep the hourly grid.
    if (!row.Date || !/T\d{2}:00:00Z$/.test(row.Date)) continue;
    const tempC = kelvinToC(row.Temperature);
    if (tempC != null) hourly.push({ at: new Date(row.Date).toISOString(), tempC });
  }
  const dailyMaxC: Record<string, number> = {};
  for (const p of d.Day_Night_Data ?? []) {
    const tempC = kelvinToC(p.Temp_Max);
    if (p.isDay && p.Date && tempC != null) dailyMaxC[p.Date.slice(0, 10)] = tempC;
  }
  return { name: null, hourly, dailyMaxC };
}

async function fetchImgw(url: string, fresh: boolean): Promise<RawForecast> {
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  const lat = params.get("lat");
  const lon = params.get("lon");
  if (!lat || !lon) throw new Error("IMGW lat/lon not found");
  const call = async (config: ImgwConfig) =>
    getResponse(`${config.base}/forecast/fcapi?token=${config.token}&lat=${lat}&lon=${lon}&m=hybrid`, {
      Accept: "application/json",
    });
  let res: Response;
  try {
    res = await call(await imgwConfig(fresh));
  } catch {
    // A redeployed site ships a new bundle (and maybe token): reread it once.
    res = await call(await imgwConfig(true));
  }
  return { ...parseImgwForecast((await res.json()) as ImgwForecastResponse), name: params.get("name") };
}

// ---- Public API -----------------------------------------------------------

function describe(url: string): Pick<OtherSourceForecast, "id" | "source"> {
  const u = new URL(url);
  if (u.hostname === "meteo.imgw.pl") return { id: new URLSearchParams(u.hash.slice(1)).get("name") ?? "", source: "imgw" };
  return { id: u.pathname.split("/").filter(Boolean).slice(-2).join("/"), source: "meteofrance.com" };
}

async function rawForecast(url: string, fresh: boolean): Promise<RawForecast> {
  const key = `other:forecast:${url}`;
  const hit = cacheGet<RawForecast>(key, FORECAST_TTL_MS);
  if (hit?.fresh && !fresh) return hit.value;
  try {
    const raw = describe(url).source === "imgw" ? await fetchImgw(url, fresh) : await fetchMeteoFranceCom(url, fresh);
    cacheSet(key, raw);
    return raw;
  } catch (error) {
    // Serve the last good forecast rather than a blank card.
    if (hit) return hit.value;
    throw error;
  }
}

export async function fetchOtherSources(
  icao: string,
  marketDate: string,
  timeZone: string,
  opts: { fresh?: boolean } = {},
): Promise<OtherSourcesPayload> {
  const sources = await Promise.all(
    otherSourceUrlsFor(icao).map(async (url): Promise<OtherSourceForecast> => {
      const base = { ...describe(url), url, name: null, maxC: null, maxScope: "day" as const, hourly: [] };
      try {
        const raw = await rawForecast(url, !!opts.fresh);
        const day = forMarketDay(raw, marketDate, timeZone);
        return day.maxC == null
          ? { ...base, name: raw.name, ...day, ok: false, error: "no forecast for this day" }
          : { ...base, name: raw.name, ...day, ok: true };
      } catch (error) {
        return { ...base, ok: false, error: error instanceof Error ? error.message : "forecast fetch failed" };
      }
    }),
  );
  return { sources, fetchedAt: new Date().toISOString() };
}

export function otherSourcesFailedPayload(error: unknown): OtherSourcesPayload {
  return {
    sources: [],
    fetchedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "forecast fetch failed",
  };
}
