import type { Region, TempUnit } from "./types";

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

export function convertTemp(celsius: number, unit: TempUnit): number {
  return unit === "F" ? cToF(celsius) : celsius;
}

export function convertDelta(deltaC: number, unit: TempUnit): number {
  return unit === "F" ? (deltaC * 9) / 5 : deltaC;
}

export function formatTemp(
  celsius: number | null | undefined,
  unit: TempUnit,
  digits = 1,
): string {
  if (celsius == null || Number.isNaN(celsius)) return "—";
  return `${convertTemp(celsius, unit).toFixed(digits)}°${unit}`;
}

export function formatMetarWind(
  dir: number | null | undefined,
  speedKt: number | null | undefined,
  gustKt?: number | null,
): string {
  if (speedKt == null) return "—";
  const heading = dir == null ? "VRB" : `${Math.round(dir)}°`;
  const gust = gustKt != null ? ` G${Math.round(gustKt)}` : "";
  return `${heading} ${Math.round(speedKt)} kt${gust}`;
}

export interface BucketRange {
  lo: number;
  hi: number;
}

/**
 * Bucket width Polymarket uses when the live event is unavailable:
 * US markets are 2 °F ranges aligned on even numbers ("70-71°F"),
 * European markets are single 1 °C values.
 */
export function fallbackBucketStep(region: Region, unit: TempUnit): number {
  return region === "america" && unit === "F" ? 2 : 1;
}

/** Bucket containing `resolvedInt` plus its two neighbours, aligned on `step`. */
export function fallbackBuckets(
  resolvedInt: number,
  step: number,
): BucketRange[] {
  const lo = Math.floor(resolvedInt / step) * step;
  return [-1, 0, 1].map((k) => ({
    lo: lo + k * step,
    hi: lo + k * step + step - 1,
  }));
}

/** Index of the bucket containing an integer resolved value, or -1. */
export function bucketIndexFor(
  buckets: Array<{ lo: number | null; hi: number | null }>,
  resolvedInt: number,
): number {
  return buckets.findIndex(
    (b) =>
      (b.lo == null || resolvedInt >= b.lo) &&
      (b.hi == null || resolvedInt <= b.hi),
  );
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/** σ of a normal distribution with the given mean absolute error. */
export function sigmaFromMae(mae: number): number {
  return mae * Math.sqrt(Math.PI / 2);
}

/**
 * Approximate probability that the resolved integer lands in each bucket,
 * assuming resolved ~ Normal(mu, sigma) in the market unit. Integer bucket
 * [lo, hi] is treated as the continuous interval [lo − 0.5, hi + 0.5].
 * Returns null when sigma is unusable.
 */
export function bucketProbabilities(
  buckets: Array<{ lo: number | null; hi: number | null }>,
  mu: number,
  sigma: number,
): number[] | null {
  if (!Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) return null;
  return buckets.map((b) => {
    const upper = b.hi == null ? 1 : normalCdf((b.hi + 0.5 - mu) / sigma);
    const lower = b.lo == null ? 0 : normalCdf((b.lo - 0.5 - mu) / sigma);
    return Math.max(0, upper - lower);
  });
}

export function formatBucketRange(range: BucketRange, unit: TempUnit): string {
  return range.lo === range.hi
    ? `${range.lo}°${unit}`
    : `${range.lo}-${range.hi}°${unit}`;
}

export function applyBias(rawC: number, biasC: number | null | undefined): number {
  if (biasC == null) return rawC;
  return rawC - biasC;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function agreementBand(
  deltaC: number | null,
): "tight" | "close" | "diverge" | "na" {
  if (deltaC == null) return "na";
  const abs = Math.abs(deltaC);
  if (abs <= 0.5) return "tight";
  if (abs <= 1) return "close";
  return "diverge";
}
