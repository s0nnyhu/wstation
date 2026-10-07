import {
  getStation,
  noaaTimeseriesUrl,
  polymarketEventUrl,
  wuHistoryUrl,
  wuResolution,
} from "@/config/stations";
import { fetchMetar } from "./metar";
import { modelLabel, pickConsensusRows, roleForModel } from "./models";
import { buildDrivers } from "./drivers";
import { withBudget } from "./http";
import { fetchHuskyConsensus, huskyFailedPayload, huskyStationUrl } from "./husky";
import { fetchWuDailyMax, wuFailedPayload } from "./wu";
import { fetchPolymarketBuckets, polymarketFailedPayload } from "./polymarket";
import { fetchPws, pwsFailedPayload } from "./pws";
import { fetchSynoptic, synopticFailedPayload } from "./synoptic";
import { fetchModelRuns } from "./modelRuns";
import {
  applyRecipe,
  effectiveInitUnix,
  windowStartUnix,
  type Lead,
  fetchRecipeFile,
  findRecipe,
  leadFor,
  localDayHoursUtc,
  rawTmax,
  recipeFailed,
  type EnsembleResult,
  type RecipeFetch,
} from "./ensemble";
import {
  fetchEnsembleTemps,
  fetchOpenMeteoForecast,
  modelsForRequest,
  numericSeries,
  seriesKey,
  stringSeries,
  type EnsembleTemps,
} from "./openmeteo";
import { median } from "./units";
import type {
  EnsemblePayload,
  HourlyPoint,
  MarketDay,
  ModelRow,
  ModelRun,
  Station,
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

/** Local "YYYY-MM-DDTHH:MM" of a UTC epoch-second instant (Open-Meteo hourly key format). */
function localKey(unix: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
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

function minMax(values: Array<number | null>): { min: number; max: number } | null {
  const xs = values.filter((v): v is number => v != null);
  return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null;
}

/** Ensemble rows: raw max (pipeline rule), recipe correction, blend status. */
function ensembleRows(
  station: Station,
  temps: EnsembleTemps | null,
  runs: Map<string, ModelRun>,
  recipeFile: RecipeFetch | null,
  marketDate: string,
  lead: Lead,
  found: ReturnType<typeof findRecipe>,
  result: EnsembleResult | null,
): ModelRow[] {
  const delays = recipeFile?.file?.model_delays_h ?? {};
  const dayHours = new Set(localDayHoursUtc(marketDate, station.timezone));
  return (station.ensemble?.models ?? []).map((id) => {
    const run = runs.get(id) ?? null;
    const series = temps?.temps[id] ?? [];
    const raw =
      temps == null
        ? null
        : rawTmax(
            temps.times,
            series,
            marketDate,
            station.timezone,
            windowStartUnix(
              lead,
              marketDate,
              station.timezone,
              effectiveInitUnix(run?.initAt, delays[id]),
              delays[id],
            ),
          );
    const dayValues = temps ? temps.times.map((t, i) => (dayHours.has(t) ? series[i] : null)) : [];
    const er = result?.rows.find((r) => r.model === id);
    const bias = found?.recipe.models[id]?.bias ?? null;
    return {
      id,
      label: modelLabel(id),
      role: er?.status === "selected" ? "blend" : "ensemble",
      rawMaxC: raw,
      rawMinC: minMax(dayValues)?.min ?? null,
      correctionC: bias,
      correctionN: found?.recipe.models[id]?.n ?? null,
      correctedMaxC: raw != null && bias != null ? raw - bias : null,
      status: er?.status ?? (raw == null ? "missing" : "no-correction"),
      weight: er?.weight ?? null,
      deltaC: null,
      available: raw != null,
      hourlyDerived: false,
      run,
    } satisfies ModelRow;
  });
}

export async function assembleStation(
  icao: string,
  day: MarketDay,
  compareAll: boolean,
  opts: { fresh?: boolean } = {},
): Promise<StationPayload> {
  const station = getStation(icao);
  if (!station) {
    throw new Error(`Unknown station ${icao}`);
  }

  const local = zonedNowParts(station.timezone);
  const marketDate = day === "tomorrow" ? addDays(local.date, 1) : local.date;
  const isEnsemble = !!station.ensemble;

  // Secondary sources get a hard budget so a slow upstream never blocks the
  // render; forecast + METAR keep their own (bounded) retry budgets.
  const SECONDARY_BUDGET_MS = 8_000;
  const requestedModels = modelsForRequest(station, compareAll);
  const runModels = [...new Set([...(station.ensemble?.models ?? []), ...requestedModels])];
  const [forecast, metar, wu, husky, polymarket, synoptic, pws, runs, ensTemps, recipeFile] =
    await Promise.all([
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
      withBudget(
        fetchPws(station.icao, opts).catch(pwsFailedPayload),
        SECONDARY_BUDGET_MS,
        pwsFailedPayload,
      ),
      withBudget(
        fetchModelRuns(runModels, station).catch(() => new Map<string, ModelRun>()),
        4_000,
        () => new Map<string, ModelRun>(),
      ),
      isEnsemble
        ? fetchEnsembleTemps(station, opts).catch(() => null)
        : Promise.resolve<EnsembleTemps | null>(null),
      isEnsemble
        ? withBudget(fetchRecipeFile(opts), 5_000, recipeFailed)
        : Promise.resolve<RecipeFetch | null>(null),
    ]);

  const modelCount = forecast.models.length;
  const dailyTimes = stringSeries(forecast.data.daily, "time");
  const hourlyTimes = stringSeries(forecast.data.hourly, "time");
  const dayIndex = dailyTimes.indexOf(marketDate);

  // ---------------------------------------------------------------- rows
  let rows: ModelRow[];
  let ensemble: EnsemblePayload | null = null;
  let headlineC: number | null;
  let headlineKind: "blend" | "raw-median";
  let consensusCorrectedC: number | null = null;
  let consensusRawC: number | null;
  let consensusModelIds: string[];
  let spreadC: { min: number; max: number } | null;

  if (isEnsemble) {
    const lead = leadFor(day, local.iso);
    const found = recipeFile ? findRecipe(recipeFile, station.icao, marketDate, lead) : null;
    // Today's outcomes below the METAR resolution high are already impossible.
    const mObs = day === "today" ? (metar.resolutionMaxC ?? null) : null;
    rows = ensembleRows(station, ensTemps, runs, recipeFile, marketDate, lead, found, null);
    const raws: Record<string, number | null> = {};
    for (const r of rows) raws[r.id] = r.rawMaxC;
    const result =
      found && recipeFile?.file
        ? applyRecipe(found.recipe, raws, recipeFile.file.discretization, mObs)
        : null;
    if (result) rows = ensembleRows(station, ensTemps, runs, recipeFile, marketDate, lead, found, result);
    const error = !ensTemps
      ? "Ensemble forecast unavailable (Open-Meteo) — no calibrated forecast"
      : !recipeFile?.ok
        ? `${recipeFile?.error ?? "Recipe unavailable"} — raw models only, no correction`
        : !found
          ? `No recipe for ${lead} on ${marketDate} — raw models only, no correction`
          : !result
            ? "No corrected model available — raw models only"
            : undefined;
    ensemble = {
      ok: result != null,
      ...(error ? { error } : {}),
      lead,
      recipeDate: found?.recipeDate,
      generatedUtc: recipeFile?.generatedUtc,
      fittedThrough: found?.recipe.distribution?.fitted_through,
      correctionMethod: found?.recipe.correction_method,
      blendMethod: found ? `${found.recipe.blend.method} · ${found.recipe.blend.size}` : undefined,
      ...(result
        ? {
            blendC: result.blendC,
            blendRawC: result.blendRawC,
            spreadC: result.spreadC,
            mu: result.mu,
            sd: result.sd,
            probs: result.probs,
            kTop: result.kTop,
            pTop: result.pTop,
            range80: result.range80,
            truncatedAt: result.truncatedAt,
            selected: result.selected,
          }
        : {}),
    };
    if (result) {
      headlineC = result.blendC;
      headlineKind = "blend";
      consensusCorrectedC = result.blendC;
      consensusRawC = result.blendRawC;
      consensusModelIds = result.selected;
      spreadC = minMax(rows.filter((r) => result.eligible.includes(r.id)).map((r) => r.correctedMaxC));
    } else {
      headlineC = median(rows.map((r) => r.rawMaxC).filter((v): v is number => v != null));
      headlineKind = "raw-median";
      consensusRawC = headlineC;
      consensusModelIds = rows.filter((r) => r.available).map((r) => r.id);
      spreadC = minMax(rows.map((r) => r.rawMaxC));
    }
  } else {
    rows = forecast.models.map((id) => {
      const dailyMaxes = numericSeries(forecast.data.daily, seriesKey("temperature_2m_max", id, modelCount));
      const dailyMins = numericSeries(forecast.data.daily, seriesKey("temperature_2m_min", id, modelCount));
      const hourlyTemps = numericSeries(forecast.data.hourly, seriesKey("temperature_2m", id, modelCount));
      const fromDaily = dayIndex >= 0 ? dailyMaxes[dayIndex] ?? null : null;
      const fromHourly = maxOnDate(hourlyTimes, hourlyTemps, marketDate);
      const rawMaxC = fromDaily ?? fromHourly.max;
      return {
        id,
        label: modelLabel(id),
        role: roleForModel(id, station, compareAll),
        rawMaxC,
        rawMinC:
          (dayIndex >= 0 ? dailyMins[dayIndex] ?? null : null) ??
          minOnDate(hourlyTimes, hourlyTemps, marketDate),
        correctionC: null,
        correctionN: null,
        correctedMaxC: null,
        deltaC: null,
        available: rawMaxC != null,
        hourlyDerived: fromDaily == null && fromHourly.max != null,
        run: runs.get(id) ?? null,
      } satisfies ModelRow;
    });
    // No calibrated correction for these stations: median of the raw maxes,
    // one vote per model family (a seamless model and its own nest are one series).
    const voters = pickConsensusRows(rows);
    consensusModelIds = voters.map((r) => r.id);
    consensusRawC = median(voters.map((r) => r.rawMaxC as number));
    headlineC = consensusRawC;
    headlineKind = "raw-median";
    spreadC = minMax(rows.map((r) => r.rawMaxC));
  }

  for (const row of rows) {
    const value = row.correctedMaxC ?? row.rawMaxC;
    row.deltaC = headlineC != null && value != null ? value - headlineC : null;
  }

  // ---------------------------------------------------------------- hourly
  const referenceSeries = (base: string) =>
    numericSeries(forecast.data.hourly, seriesKey(base, station.primary, modelCount));
  const precip = referenceSeries("precipitation_probability");
  const clouds = referenceSeries("cloud_cover");
  const wx = referenceSeries("weather_code");
  const precipMm = referenceSeries("precipitation");
  const rainMm = referenceSeries("rain");
  const windSpeed = referenceSeries("wind_speed_10m");
  const windGust = referenceSeries("wind_gusts_10m");
  const windDir = referenceSeries("wind_direction_10m");
  const shortwave = referenceSeries("shortwave_radiation");
  const humidity = referenceSeries("relative_humidity_2m");
  const hourlyByModel: Record<string, Array<number | null>> = {};
  for (const id of forecast.models) {
    hourlyByModel[id] = numericSeries(forecast.data.hourly, seriesKey("temperature_2m", id, modelCount));
  }
  // Ensemble stations: every native model on the chart, keyed by local hour.
  const ensembleByKey = new Map<string, Record<string, number | null>>();
  if (ensTemps) {
    ensTemps.times.forEach((t, i) => {
      const rec: Record<string, number | null> = {};
      for (const id of ensTemps.models) rec[id] = ensTemps.temps[id]?.[i] ?? null;
      ensembleByKey.set(localKey(t, station.timezone), rec);
    });
  }

  const hourly: HourlyPoint[] = hourlyTimes
    .map((time, index) => {
      if (!time.startsWith(marketDate)) return null;
      const tempsC: Record<string, number | null> = { ...(ensembleByKey.get(time) ?? {}) };
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
    (station.shortRange && hourly.some((p) => p.tempsC[station.shortRange!] != null)
      ? station.shortRange
      : null) ??
    station.primary;
  let peak: StationPayload["forecast"]["peak"] = null;
  for (const point of hourly) {
    const tempC = point.tempsC[peakModel];
    if (tempC != null && (!peak || tempC > peak.tempC)) {
      peak = { time: point.time, tempC, modelId: peakModel };
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
    ensemble: isEnsemble,
    noaaUrl: noaaTimeseriesUrl(station.icao, polymarket.unit ?? station.defaultUnit),
    polymarketUrl: polymarket.url ?? polymarketEventUrl(station.icao, marketDate),
    wuHistoryUrl: wuHistoryUrl(wuResolution(station.icao)?.wuStationId ?? station.icao, marketDate),
    huskyUrl: huskyStationUrl(station.icao),
  };

  return {
    station: publicStation,
    day,
    marketDate,
    localNow: local.iso,
    forecast: {
      models: rows,
      requestedModels: isEnsemble ? (station.ensemble?.models ?? []) : forecast.models,
      hourly,
      referenceId: station.primary,
      headlineC,
      headlineKind,
      consensusCorrectedC,
      consensusRawC,
      consensusModelIds,
      spreadC,
      peak,
      fetchedAt: ensTemps?.fetchedAt ?? forecast.fetchedAt,
      stale: forecast.stale || (ensTemps?.stale ?? false),
      staleReason: ensTemps?.staleReason ?? forecast.staleReason,
      requestUrl: ensTemps?.requestUrl ?? forecast.requestUrl,
      ensemble,
    },
    metar,
    wu,
    husky,
    polymarket,
    synoptic,
    pws,
    drivers: buildDrivers(hourly, peak?.time, local.iso, metar, station.primary),
    compareAll,
  };
}
