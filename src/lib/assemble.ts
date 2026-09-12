import {
  getStation,
  noaaTimeseriesUrl,
  polymarketEventUrl,
  wuHistoryUrl,
  wuResolution,
} from "@/config/stations";
import { SEASONAL_BIAS_META, getBias, seasonFromDate } from "./bias";
import { backtestFor } from "./backtest";
import { fetchMetar } from "./metar";
import { modelLabel, pickConsensusRows, roleForModel } from "./models";
import { buildDrivers } from "./drivers";
import { withBudget } from "./http";
import { fetchHuskyConsensus, huskyFailedPayload, huskyStationUrl } from "./husky";
import { fetchWuDailyMax, wuFailedPayload } from "./wu";
import { fetchPolymarketBuckets, polymarketFailedPayload } from "./polymarket";
import { fetchSynoptic, synopticFailedPayload } from "./synoptic";
import {
  fetchOpenMeteoForecast,
  numericSeries,
  seriesKey,
  stringSeries,
} from "./openmeteo";
import { applyBias, median } from "./units";
import type {
  BiasGrain,
  HourlyPoint,
  MarketDay,
  ModelRow,
  SeasonMode,
  StationPayload,
  StationPublic,
} from "./types";

function zonedNowParts(timeZone: string): { date: string; iso: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return { date, iso: `${date}T${time}` };
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function maxOnDate(
  times: string[],
  values: Array<number | null>,
  date: string,
): { max: number | null; time: string | null } {
  let max: number | null = null;
  let time: string | null = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = values[i];
    if (!t?.startsWith(date) || v == null) continue;
    if (max == null || v > max) {
      max = v;
      time = t;
    }
  }
  return { max, time };
}

function minOnDate(
  times: string[],
  values: Array<number | null>,
  date: string,
): number | null {
  let min: number | null = null;
  for (let i = 0; i < times.length; i++) {
    if (!times[i]?.startsWith(date)) continue;
    const v = values[i];
    if (v == null) continue;
    min = min == null ? v : Math.min(min, v);
  }
  return min;
}

function biasNote(modelId: string, icao: string, source: string, identical?: boolean): string | undefined {
  const bits: string[] = [];
  if (source === "none") bits.push("no bias sample");
  if (identical && (modelId === "gfs_hrrr" || modelId === "gem_hrdps_continental")) {
    bits.push("HRRR/HRDPS series matches seamless in this archive — not a native short-range bias");
  }
  if (icao === "KSEA" && source === "annual") {
    bits.push("KSEA GEM has a large seasonal swing — do not use annual-only");
  }
  if (icao === "EHAM" && modelId === "knmi_seamless") {
    bits.push("KNMI can run very hot in JJA — do not use alone");
  }
  return bits.length ? bits.join(". ") : undefined;
}

export async function assembleStation(
  icao: string,
  day: MarketDay,
  compareAll: boolean,
  opts: { fresh?: boolean; seasonMode?: SeasonMode; biasGrain?: BiasGrain } = {},
): Promise<StationPayload> {
  const station = getStation(icao);
  if (!station) {
    throw new Error(`Unknown station ${icao}`);
  }

  const seasonMode = opts.seasonMode ?? "auto";
  const biasGrain = opts.biasGrain ?? "season";
  const local = zonedNowParts(station.timezone);
  const marketDate = day === "tomorrow" ? addDays(local.date, 1) : local.date;
  const resolvedSeason =
    seasonMode === "auto" ? seasonFromDate(marketDate) : seasonMode;

  // Secondary sources get a hard budget so a slow upstream never blocks the
  // render; forecast + METAR keep their own (bounded) retry budgets.
  const SECONDARY_BUDGET_MS = 8_000;
  const [forecast, metar, wu, husky, polymarket, synoptic] = await Promise.all([
    fetchOpenMeteoForecast(station, compareAll, opts),
    fetchMetar(station.icao, station.timezone, marketDate, opts),
    withBudget(
      fetchWuDailyMax(station.icao, marketDate, station.timezone, opts).catch((error) =>
        wuFailedPayload(station.icao, error),
      ),
      SECONDARY_BUDGET_MS,
      (error) => wuFailedPayload(station.icao, error),
    ),
    withBudget(
      fetchHuskyConsensus(station.icao, marketDate, opts).catch((error) =>
        huskyFailedPayload(station.icao, error),
      ),
      SECONDARY_BUDGET_MS,
      (error) => huskyFailedPayload(station.icao, error),
    ),
    withBudget(
      fetchPolymarketBuckets(station.icao, marketDate, opts).catch((error) =>
        polymarketFailedPayload(station.icao, marketDate, error),
      ),
      SECONDARY_BUDGET_MS,
      (error) => polymarketFailedPayload(station.icao, marketDate, error),
    ),
    withBudget(
      fetchSynoptic(
        station.icao,
        station.timezone,
        marketDate,
        station.defaultUnit,
        opts,
      ).catch((error) => synopticFailedPayload(station.defaultUnit, error)),
      SECONDARY_BUDGET_MS,
      (error) => synopticFailedPayload(station.defaultUnit, error),
    ),
  ]);

  const modelCount = forecast.models.length;
  const dailyTimes = stringSeries(forecast.data.daily, "time");
  const hourlyTimes = stringSeries(forecast.data.hourly, "time");
  const dayIndex = dailyTimes.indexOf(marketDate);

  const rows: ModelRow[] = forecast.models.map((id) => {
    const dailyKey = seriesKey("temperature_2m_max", id, modelCount);
    const dailyMinKey = seriesKey("temperature_2m_min", id, modelCount);
    const hourlyKey = seriesKey("temperature_2m", id, modelCount);
    const dailyMaxes = numericSeries(forecast.data.daily, dailyKey);
    const dailyMins = numericSeries(forecast.data.daily, dailyMinKey);
    const hourlyTemps = numericSeries(forecast.data.hourly, hourlyKey);
    const fromDaily = dayIndex >= 0 ? dailyMaxes[dayIndex] ?? null : null;
    const fromHourly = maxOnDate(hourlyTimes, hourlyTemps, marketDate);
    const rawMaxC = fromDaily ?? fromHourly.max;
    const rawMinC =
      (dayIndex >= 0 ? dailyMins[dayIndex] ?? null : null) ??
      minOnDate(hourlyTimes, hourlyTemps, marketDate);
    const bias = getBias({
      icao: station.icao,
      model: id,
      dateLocal: marketDate,
      seasonMode,
      grain: biasGrain,
    });
    const correctedMaxC =
      rawMaxC == null ? null : applyBias(rawMaxC, bias.biasC);
    const note = biasNote(id, station.icao, bias.source, bias.identicalToSeamless);
    return {
      id,
      label: modelLabel(id),
      role: roleForModel(id, station, compareAll),
      rawMaxC,
      rawMinC,
      biasC: bias.source === "none" ? null : bias.biasC,
      bias,
      correctedMaxC,
      deltaVsPrimaryC: null,
      available: rawMaxC != null,
      note,
      hourlyDerived: fromDaily == null && fromHourly.max != null,
    };
  });

  const primaryRow = rows.find((r) => r.id === station.primary);
  const primaryCorrected = primaryRow?.correctedMaxC ?? null;
  const primaryRaw = primaryRow?.rawMaxC ?? null;
  const primaryRef = primaryCorrected ?? primaryRaw;

  for (const row of rows) {
    const value = row.correctedMaxC ?? row.rawMaxC;
    row.deltaVsPrimaryC =
      primaryRef != null && value != null ? value - primaryRef : null;
  }

  // One vote per model family (see pickConsensusRows).
  const consensusRows = pickConsensusRows(rows);
  const consensusModelIds = consensusRows.map((r) => r.id);
  const consensusPool = consensusRows.map((r) => r.correctedMaxC as number);
  const consensusRawPool = consensusRows
    .map((r) => r.rawMaxC)
    .filter((v): v is number => v != null);

  const raws = rows.map((r) => r.rawMaxC).filter((v): v is number => v != null);
  // Corrected spread only over rows that really were corrected, so a model
  // with no bias sample does not masquerade as a corrected value.
  const biased = rows.filter(
    (r) => r.correctedMaxC != null && r.bias.source !== "none",
  );
  const spreadRows = biased.length >= 2 ? biased : rows;
  const corrected = spreadRows
    .map((r) => r.correctedMaxC)
    .filter((v): v is number => v != null);

  const primarySeries = (base: string) =>
    numericSeries(
      forecast.data.hourly,
      seriesKey(base, station.primary, modelCount),
    );
  const precip = primarySeries("precipitation_probability");
  const clouds = primarySeries("cloud_cover");
  const wx = primarySeries("weather_code");
  const precipMm = primarySeries("precipitation");
  const rainMm = primarySeries("rain");
  const windSpeed = primarySeries("wind_speed_10m");
  const windGust = primarySeries("wind_gusts_10m");
  const windDir = primarySeries("wind_direction_10m");
  const shortwave = primarySeries("shortwave_radiation");
  const humidity = primarySeries("relative_humidity_2m");
  const hourlyByModel: Record<string, Array<number | null>> = {};
  for (const id of forecast.models) {
    hourlyByModel[id] = numericSeries(
      forecast.data.hourly,
      seriesKey("temperature_2m", id, modelCount),
    );
  }

  const hourly: HourlyPoint[] = hourlyTimes
    .map((time, index) => {
      if (!time.startsWith(marketDate)) return null;
      const tempsC: Record<string, number | null> = {};
      for (const id of forecast.models) {
        tempsC[id] = hourlyByModel[id][index] ?? null;
      }
      return {
        time,
        tempsC,
        precipProb: precip[index] ?? null,
        cloudCover: clouds[index] ?? null,
        weatherCode: wx[index] ?? null,
        precipMm: precipMm[index] ?? null,
        rainMm: rainMm[index] ?? null,
        windSpeedMps: windSpeed[index] ?? null,
        windGustMps: windGust[index] ?? null,
        windDirDeg: windDir[index] ?? null,
        shortwaveWm2: shortwave[index] ?? null,
        humidityPct: humidity[index] ?? null,
      };
    })
    .filter((p): p is HourlyPoint => p != null);

  const peakModel =
    (station.h6Model && hourly.some((p) => p.tempsC[station.h6Model!] != null)
      ? station.h6Model
      : null) ??
    (station.shortRange &&
    hourly.some((p) => p.tempsC[station.shortRange!] != null)
      ? station.shortRange
      : null) ??
    station.primary;
  const primaryHourly = hourly
    .map((p) => ({ time: p.time, tempC: p.tempsC[peakModel] ?? null }))
    .filter((p): p is { time: string; tempC: number } => p.tempC != null);
  let peak: StationPayload["forecast"]["peak"] = null;
  for (const point of primaryHourly) {
    if (!peak || point.tempC > peak.tempC) {
      peak = { time: point.time, tempC: point.tempC, modelId: peakModel };
    }
  }

  const publicStation: StationPublic = {
    icao: station.icao,
    city: station.city,
    name: station.name,
    region: station.region,
    lat: station.lat,
    lon: station.lon,
    timezone: station.timezone,
    defaultUnit: station.defaultUnit,
    primary: station.primary,
    primaryModels: station.primaryModels,
    shortRange: station.shortRange,
    h6Model: station.h6Model,
    backups: station.backups,
    notes: station.notes,
    warnings: station.warnings,
    noaaUrl: noaaTimeseriesUrl(station.icao, polymarket.unit ?? station.defaultUnit),
    polymarketUrl: polymarket.url ?? polymarketEventUrl(station.icao, marketDate),
    wuHistoryUrl: wuHistoryUrl(
      wuResolution(station.icao)?.wuStationId ?? station.icao,
      marketDate,
    ),
    huskyUrl: huskyStationUrl(station.icao),
  };

  return {
    station: publicStation,
    day,
    marketDate,
    localNow: local.iso,
    forecast: {
      models: rows,
      requestedModels: forecast.models,
      hourly,
      primaryId: station.primary,
      consensusCorrectedC: median(consensusPool),
      consensusRawC: median(consensusRawPool),
      consensusModelIds,
      spreadRawC:
        raws.length > 0
          ? { min: Math.min(...raws), max: Math.max(...raws) }
          : null,
      spreadCorrectedC:
        corrected.length > 0
          ? { min: Math.min(...corrected), max: Math.max(...corrected) }
          : null,
      spreadCorrectedCount: biased.length,
      peak,
      fetchedAt: forecast.fetchedAt,
      stale: forecast.stale,
      staleReason: forecast.staleReason,
      requestUrl: forecast.requestUrl,
      season: resolvedSeason,
      seasonMode,
      biasGrain,
    },
    metar,
    wu,
    husky,
    polymarket,
    synoptic,
    drivers: buildDrivers(
      hourly,
      peak?.time,
      local.iso,
      metar,
      station.primary,
    ),
    biasMeta: SEASONAL_BIAS_META,
    backtest: backtestFor(station.icao),
    compareAll,
    seasonMode,
    biasGrain,
  };
}

