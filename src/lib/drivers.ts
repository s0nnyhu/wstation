import type {
  DriversPayload,
  HourlyPoint,
  MetarPayload,
} from "./types";

function nums(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}

function avg(values: Array<number | null | undefined>): number | null {
  const xs = nums(values);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function maxOf(values: Array<number | null | undefined>): number | null {
  const xs = nums(values);
  if (xs.length === 0) return null;
  return Math.max(...xs);
}

function sumOf(values: Array<number | null | undefined>): number | null {
  const xs = nums(values);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0);
}

function modeOf(values: Array<number | null | undefined>): number | null {
  const xs = nums(values);
  if (xs.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of xs) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = xs[0];
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function hourOf(time: string): number {
  return Number(time.slice(11, 13));
}

function peakWindow(
  hourly: HourlyPoint[],
  peakTime: string | undefined,
): { points: HourlyPoint[]; label: string } {
  if (peakTime) {
    const peakHour = hourOf(peakTime);
    return {
      points: hourly.filter((p) => Math.abs(hourOf(p.time) - peakHour) <= 2),
      label: `±2h around ${peakTime.slice(11, 16)}`,
    };
  }
  return {
    points: hourly.filter((p) => {
      const h = hourOf(p.time);
      return h >= 12 && h <= 18;
    }),
    label: "noon–18 local (no peak)",
  };
}

function latestHourly(
  hourly: HourlyPoint[],
  localNow: string,
): HourlyPoint | null {
  const cutoff = localNow.slice(0, 16);
  let latest: HourlyPoint | null = null;
  for (const point of hourly) {
    if (point.time.slice(0, 16) <= cutoff) latest = point;
  }
  return latest;
}

/**
 * Simple peak-window heuristics for max-temp markets — not ML, not bias.
 * - wind cooling: mean 10 m wind ≥ 5 m/s (≈10 kt) in the peak window
 * - thick cloud: mean cloud cover ≥ 70%
 * - showers near peak: max precip probability ≥ 40% or summed precip ≥ 0.5 mm
 * - strong sun: mean shortwave ≥ 500 W/m² and mean cloud ≤ 40%
 * - clearing: mean cloud in the first half of the window is ≥ 15 pp higher
 *   than the second half (cloud falling into the max)
 */
function flagsFor(
  window: HourlyPoint[],
  around: DriversPayload["aroundPeak"],
): string[] {
  const flags: string[] = [];
  if ((around.avgWindSpeedMps ?? 0) >= 5) flags.push("wind cooling");
  if ((around.avgCloudCover ?? 0) >= 70) flags.push("thick cloud");
  if ((around.maxPrecipProb ?? 0) >= 40 || (around.sumPrecipMm ?? 0) >= 0.5) {
    flags.push("showers near peak");
  }
  if (
    (around.avgShortwaveWm2 ?? 0) >= 500 &&
    (around.avgCloudCover ?? 100) <= 40
  ) {
    flags.push("strong sun");
  }
  if (window.length >= 4) {
    const mid = Math.floor(window.length / 2);
    const early = avg(window.slice(0, mid).map((p) => p.cloudCover));
    const late = avg(window.slice(mid).map((p) => p.cloudCover));
    if (early != null && late != null && early - late >= 15) {
      flags.push("clearing");
    }
  }
  return flags;
}

export function buildDrivers(
  hourly: HourlyPoint[],
  peakTime: string | undefined,
  localNow: string,
  metar: MetarPayload,
  modelId: string,
): DriversPayload {
  const { points, label } = peakWindow(hourly, peakTime);
  const aroundPeak = {
    avgCloudCover: avg(points.map((p) => p.cloudCover)),
    maxPrecipProb: maxOf(points.map((p) => p.precipProb)),
    sumPrecipMm: sumOf(points.map((p) => p.precipMm)),
    avgWindSpeedMps: avg(points.map((p) => p.windSpeedMps)),
    maxGustMps: maxOf(points.map((p) => p.windGustMps)),
    avgShortwaveWm2: avg(points.map((p) => p.shortwaveWm2)),
    dominantWeatherCode: modeOf(points.map((p) => p.weatherCode)),
  };
  const latest = latestHourly(hourly, localNow);
  const now = {
    cloudCover: latest?.cloudCover ?? null,
    precipProb: latest?.precipProb ?? null,
    precipMm: latest?.precipMm ?? null,
    windSpeedMps: latest?.windSpeedMps ?? null,
    shortwaveWm2: latest?.shortwaveWm2 ?? null,
    humidityPct: latest?.humidityPct ?? null,
    metarWindKt: metar.latest?.windSpeedKt ?? null,
    metarWindDirDeg: metar.latest?.windDirDeg ?? null,
    metarGustKt: metar.latest?.windGustKt ?? null,
  };
  return {
    modelId,
    windowLabel: label,
    aroundPeak,
    now,
    flags: flagsFor(points, aroundPeak),
  };
}

export function weatherCodeHint(code: number | null | undefined): string {
  if (code == null) return "";
  if (code === 0) return "clear";
  if (code <= 3) return "partly cloudy";
  if (code >= 95) return "thunder";
  if (code >= 80) return "showers";
  if (code >= 71) return "snow";
  if (code >= 66) return "freezing rain";
  if (code >= 51) return "rain";
  if (code >= 45) return "fog";
  return `wx ${code}`;
}
