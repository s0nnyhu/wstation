import { wuForecastUrl, wuResolution } from "@/config/stations";
import { cacheGet, cacheSet, FRESH_MIN_AGE_MS, WU_TTL_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import type { WuHourlyPoint, WuPayload } from "./types";
import { iconFromPhrase, iconFromTwc } from "./weatherIcon";

const USER_AGENT =
  "Mozilla/5.0 (compatible; WStation/0.1; +https://github.com/local/wstation)";
const DEFAULT_WU_KEY = "e1f10a1e78da46f5b10a1e78da96f525";

/**
 * Weather.com / WU endpoints used as the Polymarket resolution proxy.
 * Station ICAO is the airport in `WU_RESOLUTION` (EGLC≠EGLL, LFPB≠LFPG, KHOU≠IAH).
 *
 * Daily 5-day (metric °C):
 *   GET https://api.weather.com/v3/wx/forecast/daily/5day?icaoCode={ICAO}&units=m&language=en-US&format=json&apiKey=
 * Hourly 2-day (metric °C, wind km/h, pressure hPa):
 *   GET https://api.weather.com/v3/wx/forecast/hourly/2day?icaoCode={ICAO}&units=m&language=en-US&format=json&apiKey=
 * Current observation:
 *   GET https://api.weather.com/v1/location/{ICAO}:9:{CC}/observations/current.json?apiKey=&units=m&language=en-US
 *
 * `WU_API_KEY` overrides the public web key. The app still runs without a key
 * (METAR-only fallback) if weather.com rejects the default.
 */
interface WuDailySeries {
  dates: string[];
  daytimeMaxC: Array<number | null>;
  calendarMaxC: Array<number | null>;
  calendarMinC: Array<number | null>;
}

interface WuHourlyRaw {
  validTimeLocal: string;
  temperature: number | null;
  precipChance: number | null;
  wxPhraseShort?: string;
  iconCode?: number | null;
  dayOrNight?: string | null;
}

interface WuCurrentRaw {
  obsTimeLocal?: string;
  tempC?: number | null;
  phrase?: string | null;
  windKmh?: number | null;
  windDirDeg?: number | null;
  humidityPct?: number | null;
  pressureHPa?: number | null;
  iconCode?: number | null;
  dayOrNight?: string | null;
}

interface WuBundle {
  daily: WuDailySeries;
  hourly: WuHourlyRaw[];
  current: WuCurrentRaw | null;
}

function wuApiKey(): string {
  return process.env.WU_API_KEY?.trim() || DEFAULT_WU_KEY;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyWu(icao: string, extra: Partial<WuPayload> = {}): WuPayload {
  const res = wuResolution(icao);
  const id = res?.wuStationId ?? icao;
  return {
    ok: extra.ok ?? false,
    stationId: id,
    dailyMaxC: extra.dailyMaxC ?? null,
    predictedHighC: extra.predictedHighC ?? extra.dailyMaxC ?? null,
    lowC: extra.lowC ?? null,
    currentTempC: extra.currentTempC ?? null,
    hourly: extra.hourly ?? [],
    fetchedAt: extra.fetchedAt ?? new Date().toISOString(),
    stale: extra.stale ?? false,
    forecastUrl: wuForecastUrl(id),
    ...extra,
  };
}

function pickMax(
  daytime: number | null | undefined,
  calendar: number | null | undefined,
): number | null {
  if (typeof daytime === "number" && Number.isFinite(daytime)) return daytime;
  if (typeof calendar === "number" && Number.isFinite(calendar)) return calendar;
  return null;
}

function localDatePrefix(stamp: string | undefined | null): string | null {
  if (!stamp) return null;
  const date = stamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function localHour(stamp: string): string {
  return stamp.length >= 16 ? stamp.slice(11, 16) : "—";
}

async function getJson(
  url: string,
  timeoutMs = 6_000,
): Promise<unknown> {
  const response = await fetchWithBackoff(
    url,
    { headers: { Accept: "application/json", "User-Agent": USER_AGENT } },
    { timeoutMs, retries: 0 },
  );
  if (!response.ok) throw new Error(`WU HTTP ${response.status}`);
  return response.json();
}

function parseDaily(json: {
  validTimeLocal?: string[];
  temperatureMax?: Array<number | null>;
  calendarDayTemperatureMax?: Array<number | null>;
  calendarDayTemperatureMin?: Array<number | null>;
}): WuDailySeries {
  const times = json.validTimeLocal ?? [];
  return {
    dates: times.map((t) => t.slice(0, 10)),
    daytimeMaxC: json.temperatureMax ?? [],
    calendarMaxC: json.calendarDayTemperatureMax ?? [],
    calendarMinC: json.calendarDayTemperatureMin ?? [],
  };
}

function parseHourly(json: {
  validTimeLocal?: string[];
  temperature?: Array<number | null>;
  precipChance?: Array<number | null>;
  wxPhraseShort?: string[];
  iconCode?: Array<number | null>;
  dayOrNight?: string[];
}): WuHourlyRaw[] {
  const times = json.validTimeLocal ?? [];
  return times.map((validTimeLocal, i) => ({
    validTimeLocal,
    temperature: num(json.temperature?.[i]),
    precipChance: num(json.precipChance?.[i]),
    wxPhraseShort: json.wxPhraseShort?.[i],
    iconCode: num(json.iconCode?.[i]),
    dayOrNight: json.dayOrNight?.[i] ?? null,
  }));
}

function parseCurrent(json: {
  observation?: {
    obs_time_local?: string;
    phrase_32char?: string;
    wx_phrase?: string;
    icon_code?: number;
    day_ind?: string;
    wdir?: number | string;
    metric?: {
      temp?: number;
      rh?: number;
      mslp?: number;
      wspd?: number;
    };
  };
}): WuCurrentRaw | null {
  const obs = json.observation;
  if (!obs) return null;
  const dir =
    typeof obs.wdir === "number"
      ? obs.wdir
      : typeof obs.wdir === "string" && /^\d+$/.test(obs.wdir)
        ? Number(obs.wdir)
        : null;
  return {
    obsTimeLocal: obs.obs_time_local,
    tempC: num(obs.metric?.temp),
    phrase: obs.phrase_32char ?? obs.wx_phrase ?? null,
    windKmh: num(obs.metric?.wspd),
    windDirDeg: dir,
    humidityPct: num(obs.metric?.rh),
    pressureHPa: num(obs.metric?.mslp),
    iconCode: num(obs.icon_code),
    dayOrNight: obs.day_ind ?? null,
  };
}

function zonedToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function selectHourly(
  hourly: WuHourlyRaw[],
  marketDate: string,
  timeZone: string,
  now: Date,
): WuHourlyPoint[] {
  const onDate = hourly.filter(
    (h) => localDatePrefix(h.validTimeLocal) === marketDate,
  );
  // Market-day hours only (scrollable). A rolling 12-hour window at 01:00
  // ended at noon and hid the afternoon peak the market cares about.
  let slice: WuHourlyRaw[];
  if (marketDate !== zonedToday(timeZone)) {
    slice = onDate.slice(0, 24);
  } else {
    slice = onDate.filter((h) => {
      const t = Date.parse(h.validTimeLocal);
      return Number.isFinite(t) ? t >= now.getTime() - 30 * 60_000 : true;
    });
  }
  return slice.map((h) => ({
    time: h.validTimeLocal,
    localHour: localHour(h.validTimeLocal),
    tempC: h.temperature,
    precipProb: h.precipChance,
    condition: h.wxPhraseShort,
    icon:
      iconFromTwc(h.iconCode, h.dayOrNight) ??
      iconFromPhrase(h.wxPhraseShort, h.dayOrNight === "N"),
  }));
}

function payloadFromBundle(
  icao: string,
  marketDate: string,
  timeZone: string,
  bundle: WuBundle,
  extra: Partial<WuPayload> = {},
): WuPayload {
  const idx = bundle.daily.dates.indexOf(marketDate);
  const dailyMaxC =
    idx >= 0
      ? pickMax(bundle.daily.daytimeMaxC[idx], bundle.daily.calendarMaxC[idx])
      : null;
  const lowC = idx >= 0 ? num(bundle.daily.calendarMinC[idx]) : null;
  const currentDate = localDatePrefix(bundle.current?.obsTimeLocal);
  const currentOnDate = currentDate === marketDate ? bundle.current : null;
  const night = currentOnDate?.dayOrNight === "N";

  return emptyWu(icao, {
    ok: true,
    dailyMaxC,
    predictedHighC: dailyMaxC,
    lowC,
    currentTempC: currentOnDate?.tempC ?? null,
    condition: currentOnDate?.phrase ?? null,
    windKmh: currentOnDate?.windKmh ?? null,
    windDirDeg: currentOnDate?.windDirDeg ?? null,
    humidityPct: currentOnDate?.humidityPct ?? null,
    pressureHPa: currentOnDate?.pressureHPa ?? null,
    icon: currentOnDate
      ? iconFromTwc(currentOnDate.iconCode, currentOnDate.dayOrNight) ||
        iconFromPhrase(currentOnDate.phrase, night)
      : undefined,
    hourly: selectHourly(bundle.hourly, marketDate, timeZone, new Date()),
    ...extra,
  });
}

async function fetchBundle(
  stationId: string,
  country: string,
): Promise<{ bundle: WuBundle; errors: string[] }> {
  const key = wuApiKey();
  const dailyUrl = new URL("https://api.weather.com/v3/wx/forecast/daily/5day");
  dailyUrl.searchParams.set("icaoCode", stationId);
  dailyUrl.searchParams.set("units", "m");
  dailyUrl.searchParams.set("language", "en-US");
  dailyUrl.searchParams.set("format", "json");
  dailyUrl.searchParams.set("apiKey", key);

  const hourlyUrl = new URL("https://api.weather.com/v3/wx/forecast/hourly/2day");
  hourlyUrl.searchParams.set("icaoCode", stationId);
  hourlyUrl.searchParams.set("units", "m");
  hourlyUrl.searchParams.set("language", "en-US");
  hourlyUrl.searchParams.set("format", "json");
  hourlyUrl.searchParams.set("apiKey", key);

  const currentUrl = new URL(
    `https://api.weather.com/v1/location/${stationId}:9:${country}/observations/current.json`,
  );
  currentUrl.searchParams.set("apiKey", key);
  currentUrl.searchParams.set("units", "m");
  currentUrl.searchParams.set("language", "en-US");

  const errors: string[] = [];
  const [dailySettled, hourlySettled, currentSettled] = await Promise.allSettled([
    getJson(dailyUrl.toString()),
    getJson(hourlyUrl.toString()),
    getJson(currentUrl.toString()),
  ]);

  let daily: WuDailySeries = {
    dates: [],
    daytimeMaxC: [],
    calendarMaxC: [],
    calendarMinC: [],
  };
  if (dailySettled.status === "fulfilled") {
    daily = parseDaily(dailySettled.value as Parameters<typeof parseDaily>[0]);
  } else {
    errors.push(
      dailySettled.reason instanceof Error
        ? dailySettled.reason.message
        : "daily failed",
    );
  }

  let hourly: WuHourlyRaw[] = [];
  if (hourlySettled.status === "fulfilled") {
    hourly = parseHourly(
      hourlySettled.value as Parameters<typeof parseHourly>[0],
    );
  } else {
    errors.push(
      hourlySettled.reason instanceof Error
        ? hourlySettled.reason.message
        : "hourly failed",
    );
  }

  let current: WuCurrentRaw | null = null;
  if (currentSettled.status === "fulfilled") {
    current = parseCurrent(
      currentSettled.value as Parameters<typeof parseCurrent>[0],
    );
  } else {
    errors.push(
      currentSettled.reason instanceof Error
        ? currentSettled.reason.message
        : "current failed",
    );
  }

  return { bundle: { daily, hourly, current }, errors };
}

export async function fetchWuDailyMax(
  icao: string,
  marketDate: string,
  timezone: string,
  opts: { fresh?: boolean } = {},
): Promise<WuPayload> {
  const res = wuResolution(icao);
  if (!res) {
    return emptyWu(icao, { error: `No WU station for ${icao}` });
  }

  const cacheKey = `wu:panel:v1:${res.wuStationId}`;
  const cached = cacheGet<WuBundle>(cacheKey, WU_TTL_MS);
  let bundle = cached?.fresh ? cached.value : undefined;

  if (!bundle || (opts.fresh && (cached?.ageMs ?? 0) > FRESH_MIN_AGE_MS)) {
    try {
      const { bundle: next, errors } = await fetchBundle(
        res.wuStationId,
        res.wuCountry,
      );
      const useful =
        next.daily.dates.length > 0 ||
        next.hourly.length > 0 ||
        next.current != null;
      if (!useful) {
        throw new Error(errors[0] ?? "WU unavailable");
      }
      bundle = next;
      cacheSet(cacheKey, bundle);
      const error = errors.length ? errors.join("; ") : undefined;
      return payloadFromBundle(res.wuStationId, marketDate, timezone, bundle, {
        stale: false,
        error,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WU fetch failed";
      if (cached) {
        return payloadFromBundle(
          res.wuStationId,
          marketDate,
          timezone,
          cached.value,
          {
            stale: true,
            error: `Cached WU (${message})`,
          },
        );
      }
      return emptyWu(res.wuStationId, { ok: false, error: message });
    }
  }

  return payloadFromBundle(res.wuStationId, marketDate, timezone, bundle, {
    stale: false,
  });
}

export function wuFailedPayload(icao: string, error: unknown): WuPayload {
  return emptyWu(icao, {
    ok: false,
    error: error instanceof Error ? error.message : "WU fetch failed",
  });
}
