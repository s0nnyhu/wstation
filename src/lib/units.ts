import type { TempUnit } from "./types";

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

/** METAR wind (knots in) as km/h for °C views, mph for °F views. */
export function formatMetarWind(
  dir: number | null | undefined,
  speedKt: number | null | undefined,
  gustKt: number | null | undefined,
  unit: TempUnit,
): string {
  if (speedKt == null) return "—";
  const speed = (kt: number) =>
    unit === "F" ? `${Math.round(kt * 1.15078)}` : `${Math.round(kt * 1.852)}`;
  const heading = dir == null ? "VRB" : `${Math.round(dir)}°`;
  const gust = gustKt != null ? ` G${speed(gustKt)}` : "";
  return `${heading} ${speed(speedKt)}${gust} ${unit === "F" ? "mph" : "km/h"}`;
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
