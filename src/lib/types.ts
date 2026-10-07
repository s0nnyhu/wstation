import type { WeatherIconKind } from "./weatherIcon";

export type { WeatherIconKind };

export type TempUnit = "C" | "F";
export type MarketDay = "today" | "tomorrow";
export type Region = "europe" | "america" | "asia";
export type RegionFilter = "all" | Region;
/**
 * primary / short-range / backup / compare / extra: raw models of stations
 * without a calibrated ensemble. blend / ensemble: native models of the four
 * stations analysed by weather-analysis (blend = in today's blend).
 */
export type ModelRole = "primary" | "short-range" | "backup" | "compare" | "extra" | "blend" | "ensemble";

export interface Station {
  icao: string;
  city: string;
  name: string;
  region: Region;
  lat: number;
  lon: number;
  timezone: string;
  defaultUnit: TempUnit;
  primary: string;
  primaryModels: string[];
  shortRange?: string;
  h6Model?: string;
  backups: string[];
  domainExtras: string[];
  notes: string[];
  warnings: string[];
  /**
   * Calibrated ensemble (EDDM, LFPB, EGLC, EHAM): native models corrected and
   * blended with the weather-analysis recipe. `primary` is then only the
   * reference model for the hourly chart and drivers.
   */
  ensemble?: { models: string[] };
}

/** Latest Open-Meteo model run feeding this row (from `/data/{dataset}/static/meta.json`). */
export interface ModelRun {
  /** UTC initialisation time (ISO). */
  initAt: string;
  /** e.g. "09Z". */
  initZ: string;
  /** When that run became available on Open-Meteo (ISO), if known. */
  availableAt: string | null;
  /** Open-Meteo dataset directory, e.g. `dwd_icon_d2`. */
  dataset: string;
  /** High-res nest name when `id` is a seamless blend, else null. */
  nest: string | null;
}

export interface ModelRow {
  id: string;
  label: string;
  role: ModelRole;
  rawMaxC: number | null;
  rawMinC: number | null;
  /** Ensemble stations: walk-forward bias (forecast − METAR max); corrected = raw − bias. */
  correctionC: number | null;
  /** Number of past days behind the correction. */
  correctionN: number | null;
  correctedMaxC: number | null;
  /** Ensemble stations: why the model is or is not in the blend. */
  status?: import("./ensemble").MemberStatus;
  /** Ensemble stations: weight in the blend (sums to 1 over the blend). */
  weight?: number | null;
  /** Corrected (ensemble) or raw max minus the headline value. */
  deltaC: number | null;
  available: boolean;
  note?: string;
  hourlyDerived?: boolean;
  run?: ModelRun | null;
}

export interface HourlyPoint {
  time: string;
  tempsC: Record<string, number | null>;
  precipProb: number | null;
  cloudCover: number | null;
  weatherCode: number | null;
  precipMm: number | null;
  rainMm: number | null;
  windSpeedMps: number | null;
  windGustMps: number | null;
  windDirDeg: number | null;
  shortwaveWm2: number | null;
  humidityPct: number | null;
}

export interface MetarLatest {
  /** Best precision available: T-group tenths when present, else body integer. */
  tempC: number;
  /**
   * Integer °C from the METAR body (the value ASOS 5-minute feeds and the
   * NOAA timeseries page round from). Null when the body token is missing.
   */
  tempBodyC: number | null;
  dewpointC: number | null;
  observedAt: string;
  raw: string;
  name?: string;
  windDirDeg?: number | null;
  windSpeedKt?: number | null;
  windGustKt?: number | null;
  visibility?: string | null;
  altimeterHPa?: number | null;
  sky?: string | null;
  humidityPct?: number | null;
  icon?: WeatherIconKind;
}

export interface MetarStripPoint {
  at: string;
  tempC: number;
  sky?: string | null;
  icon: WeatherIconKind;
}

export interface MetarPayload {
  ok: boolean;
  error?: string;
  latest?: MetarLatest;
  /** Market-local-day observations, oldest first, capped. */
  observations?: MetarStripPoint[];
  /** Physical running max (tenths when available) for the market local day. */
  runningMaxC?: number | null;
  runningMaxAt?: string | null;
  /**
   * Resolution-style running max: max of the integer-°C body values for the
   * market local day. Convert + round to the market unit to compare with
   * Polymarket buckets. Lower bound of the NOAA value (5-minute obs between
   * METARs are not visible here).
   */
  resolutionMaxC?: number | null;
  observationCount?: number;
  declining?: boolean;
  fetchedAt: string;
  stale: boolean;
}

export interface EnsemblePayload {
  ok: boolean;
  error?: string;
  lead: import("./ensemble").Lead;
  /** Date of the recipe used (earlier than the market date just after midnight). */
  recipeDate?: string;
  generatedUtc?: string;
  fittedThrough?: string;
  correctionMethod?: string;
  blendMethod?: string;
  blendC?: number;
  blendRawC?: number;
  spreadC?: number | null;
  mu?: number | null;
  sd?: number | null;
  probs?: Array<{ k: number; p: number }>;
  kTop?: number | null;
  pTop?: number | null;
  range80?: { lo: number; hi: number } | null;
  /** METAR resolution high used to exclude lower outcomes (today). */
  truncatedAt?: number | null;
  selected?: string[];
}

export interface ForecastPayload {
  models: ModelRow[];
  requestedModels: string[];
  hourly: HourlyPoint[];
  /** Model behind the hourly chart and drivers. */
  referenceId: string;
  /** Headline daily max: calibrated blend (ensemble stations) or raw family median. */
  headlineC: number | null;
  headlineKind: "blend" | "raw-median";
  /** Ensemble stations: the blend (corrected). Null elsewhere — no calibrated correction. */
  consensusCorrectedC: number | null;
  /** Ensemble stations: mean raw max of the blend members; elsewhere raw median, one vote per family. */
  consensusRawC: number | null;
  consensusModelIds: string[];
  /** Min–max of the values behind the headline (corrected members, or raw voting models). */
  spreadC: { min: number; max: number } | null;
  peak: { time: string; tempC: number; modelId: string } | null;
  fetchedAt: string;
  stale: boolean;
  staleReason?: string;
  requestUrl?: string;
  ensemble: EnsemblePayload | null;
}

export interface StationPublic {
  icao: string;
  city: string;
  name: string;
  region: Region;
  lat: number;
  lon: number;
  timezone: string;
  defaultUnit: TempUnit;
  primary: string;
  primaryModels: string[];
  shortRange?: string;
  h6Model?: string;
  backups: string[];
  notes: string[];
  warnings: string[];
  /** True for the calibrated-ensemble stations. */
  ensemble: boolean;
  /** NOAA WRH timeseries page — the Polymarket resolution source. */
  noaaUrl?: string;
  polymarketUrl?: string;
  wuHistoryUrl?: string;
  huskyUrl?: string;
}

export interface WuHourlyPoint {
  time: string;
  localHour: string;
  tempC: number | null;
  precipProb: number | null;
  condition?: string;
  icon: WeatherIconKind;
}

export interface WuPayload {
  ok: boolean;
  error?: string;
  stationId?: string;
  /** Forecast daytime / calendar high for the market date. */
  dailyMaxC?: number | null;
  predictedHighC?: number | null;
  lowC?: number | null;
  currentTempC?: number | null;
  condition?: string | null;
  windKmh?: number | null;
  windDirDeg?: number | null;
  humidityPct?: number | null;
  pressureHPa?: number | null;
  icon?: WeatherIconKind;
  hourly?: WuHourlyPoint[];
  fetchedAt: string;
  stale: boolean;
  forecastUrl?: string;
}

/**
 * Optional Synoptic feed (the same data the NOAA timeseries page renders).
 * Only populated when SYNOPTIC_TOKEN is set.
 */
export interface SynopticPayload {
  ok: boolean;
  configured: boolean;
  error?: string;
  /** Max of round(air_temp in market unit) over the market local day. */
  resolutionMax: number | null;
  resolutionMaxAt: string | null;
  /** Max air_temp in °C (as reported, tenths or integer). */
  maxC: number | null;
  latestC: number | null;
  latestAt: string | null;
  observationCount: number;
  unit: TempUnit;
  fetchedAt: string;
  stale: boolean;
}

export interface HuskyPayload {
  ok: boolean;
  error?: string;
  dailyMaxC?: number | null;
  localDate?: string | null;
  fetchedAt: string;
  stale: boolean;
  url: string;
}

/** One Polymarket outcome, bounds inclusive integers in `unit`. */
export interface PolymarketBucket {
  label: string;
  /** null = open-ended low tail ("X or below"). */
  lo: number | null;
  /** null = open-ended high tail ("X or higher"). */
  hi: number | null;
  unit: TempUnit;
  yesPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  marketSlug?: string;
}

export interface PolymarketPayload {
  ok: boolean;
  error?: string;
  slug: string;
  url?: string;
  title?: string;
  closed?: boolean;
  /** Market unit, taken from the bucket labels. */
  unit: TempUnit | null;
  /** Width of a regular bucket in `unit` (1 or 2), null if unknown. */
  step: number | null;
  buckets: PolymarketBucket[];
  /** Short hint parsed from the event description, e.g. "NOAA weather.gov". */
  resolutionHint?: string;
  fetchedAt: string;
  stale: boolean;
}

export interface DriversAroundPeak {
  avgCloudCover: number | null;
  maxPrecipProb: number | null;
  sumPrecipMm: number | null;
  avgWindSpeedMps: number | null;
  maxGustMps: number | null;
  avgShortwaveWm2: number | null;
  dominantWeatherCode: number | null;
}

export interface DriversNow {
  cloudCover: number | null;
  precipProb: number | null;
  precipMm: number | null;
  windSpeedMps: number | null;
  shortwaveWm2: number | null;
  humidityPct: number | null;
  metarWindKt: number | null;
  metarWindDirDeg: number | null;
  metarGustKt: number | null;
}

export interface DriversPayload {
  modelId: string;
  windowLabel: string;
  aroundPeak: DriversAroundPeak;
  now: DriversNow;
  flags: string[];
}

export interface PwsReading {
  id: string;
  source: "awekas" | "wunderground" | "hko";
  url: string;
  name: string | null;
  /** Current air temperature, °C. */
  tempC: number | null;
  obsTimeIso: string | null;
  ok: boolean;
  error?: string;
}

export interface PwsPayload {
  stations: PwsReading[];
  fetchedAt: string;
  stale: boolean;
  error?: string;
}

export interface StationPayload {
  station: StationPublic;
  day: MarketDay;
  marketDate: string;
  localNow: string;
  forecast: ForecastPayload;
  metar: MetarPayload;
  wu: WuPayload;
  husky: HuskyPayload;
  polymarket: PolymarketPayload;
  synoptic: SynopticPayload;
  pws: PwsPayload;
  drivers: DriversPayload;
  compareAll: boolean;
}
