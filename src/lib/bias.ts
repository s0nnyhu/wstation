import seasonal from "../../data/biases.seasonal.json";
import type {
  BiasGrain,
  BiasResolution,
  BiasSource,
  Season,
  SeasonMode,
  TempUnit,
} from "./types";

export const MIN_BIAS_N = 20;

export const SEASON_MONTHS: Record<Season, number[]> = {
  DJF: [12, 1, 2],
  MAM: [3, 4, 5],
  JJA: [6, 7, 8],
  SON: [9, 10, 11],
};

const SEAMLESS_PROXY: Record<string, string> = {
  gfs_hrrr: "gfs_seamless",
  gem_hrdps_continental: "gem_seamless",
};

interface BiasStat {
  n: number;
  bias: number;
  mae?: number;
}

interface ModelBiasBlock {
  annual?: BiasStat;
  seasons?: Partial<Record<Season, BiasStat>>;
  months?: Record<string, BiasStat>;
}

interface StationBiasBlock {
  region?: string;
  unit?: TempUnit;
  models?: Record<string, ModelBiasBlock>;
}

interface SeasonalFile {
  version?: string;
  correction?: string;
  window?: { start?: string; end?: string };
  stations: Record<string, StationBiasBlock>;
}

const table = seasonal as SeasonalFile;

const WINDOW_START = table.window?.start ?? "2024-01-01";
const WINDOW_END = table.window?.end ?? "2026-09-01";

export const SEASONAL_BIAS_META = {
  source:
    "Empirical ASOS bias from Open-Meteo historical-forecast (forecast_daily_max − asos_daily_max)",
  sample: `${WINDOW_START} → ${WINDOW_END}`,
  asOf: WINDOW_END,
  definition:
    "corrected = raw − bias. Seasonal means, not climate normals. Annual is fallback only when season n < 20.",
};

export function seasonFromDate(dateLocal: string): Season {
  const month = Number(dateLocal.slice(5, 7));
  if (month === 12 || month === 1 || month === 2) return "DJF";
  if (month >= 3 && month <= 5) return "MAM";
  if (month >= 6 && month <= 8) return "JJA";
  return "SON";
}

export function monthKey(dateLocal: string): string {
  return dateLocal.slice(5, 7);
}

function usable(stat: BiasStat | undefined): stat is BiasStat {
  return !!stat && Number.isFinite(stat.bias) && stat.n >= MIN_BIAS_N;
}

function toCelsius(biasNative: number, unit: TempUnit): number {
  return unit === "F" ? (biasNative * 5) / 9 : biasNative;
}

function identicalStats(a?: BiasStat, b?: BiasStat): boolean {
  if (!a || !b) return false;
  return a.n === b.n && a.bias === b.bias && a.mae === b.mae;
}

export function getBias(opts: {
  icao: string;
  model: string;
  dateLocal: string;
  seasonMode?: SeasonMode;
  grain?: BiasGrain;
}): BiasResolution {
  const season =
    !opts.seasonMode || opts.seasonMode === "auto"
      ? seasonFromDate(opts.dateLocal)
      : opts.seasonMode;
  const station = table.stations[opts.icao.toUpperCase()];
  const unit: TempUnit = station?.unit === "F" ? "F" : "C";
  const model = station?.models?.[opts.model];
  const proxyOf = SEAMLESS_PROXY[opts.model];
  const seamless = proxyOf ? station?.models?.[proxyOf] : undefined;
  const identicalToSeamless = !!(
    seamless &&
    model &&
    (identicalStats(model.annual, seamless.annual) ||
      identicalStats(model.seasons?.[season], seamless.seasons?.[season]))
  );

  const empty = (source: BiasSource): BiasResolution => ({
    season,
    source,
    unit,
    biasNative: null,
    biasC: 0,
    n: 0,
    identicalToSeamless,
  });

  if (!model) {
    return empty("none");
  }

  if (opts.grain === "month") {
    const key = monthKey(opts.dateLocal);
    const monthly = model.months?.[key];
    if (usable(monthly)) {
      return {
        season,
        month: key,
        source: "month",
        unit,
        biasNative: monthly.bias,
        biasC: toCelsius(monthly.bias, unit),
        n: monthly.n,
        mae: monthly.mae,
        identicalToSeamless,
      };
    }
  }

  const seasonal = model.seasons?.[season];
  if (usable(seasonal)) {
    return {
      season,
      source: "season",
      unit,
      biasNative: seasonal.bias,
      biasC: toCelsius(seasonal.bias, unit),
      n: seasonal.n,
      mae: seasonal.mae,
      identicalToSeamless,
    };
  }

  if (usable(model.annual)) {
    return {
      season,
      source: "annual",
      unit,
      biasNative: model.annual.bias,
      biasC: toCelsius(model.annual.bias, unit),
      n: model.annual.n,
      mae: model.annual.mae,
      identicalToSeamless,
    };
  }

  return empty("none");
}

export function parseSeasonMode(value: string | null | undefined): SeasonMode {
  if (
    value === "DJF" ||
    value === "MAM" ||
    value === "JJA" ||
    value === "SON"
  ) {
    return value;
  }
  return "auto";
}

export function parseBiasGrain(value: string | null | undefined): BiasGrain {
  return value === "month" ? "month" : "season";
}
