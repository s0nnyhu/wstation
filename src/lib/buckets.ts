import type { StationPayload, TempUnit } from "./types";
import {
  bucketIndexFor,
  convertTemp,
  fallbackBucketStep,
  fallbackBuckets,
  formatBucketRange,
} from "./units";

export interface BucketSuggestion {
  label: string;
  target: boolean;
  yesPrice: number | null;
}

export interface BucketSuggestionSet {
  marketUnit: TempUnit;
  resolvedInt: number | null;
  live: boolean;
  items: BucketSuggestion[];
}

/**
 * Buckets around the resolved integer. Uses the live Polymarket event when
 * available, else the regional convention (US 2 °F even-aligned, EU 1 °C).
 */
export function suggestBuckets(
  data: Pick<StationPayload, "polymarket" | "station">,
  targetC: number | null,
): BucketSuggestionSet {
  const pm = data.polymarket;
  const marketUnit: TempUnit = pm.unit ?? data.station.defaultUnit;
  if (targetC == null) {
    return { marketUnit, resolvedInt: null, live: false, items: [] };
  }
  const resolvedInt = Math.round(convertTemp(targetC, marketUnit));

  if (pm.ok && pm.buckets.length > 0) {
    const idx = bucketIndexFor(pm.buckets, resolvedInt);
    if (idx >= 0) {
      const items = pm.buckets
        .slice(Math.max(0, idx - 1), idx + 2)
        .map((b) => ({
          label: b.label,
          target: b === pm.buckets[idx],
          yesPrice: b.yesPrice,
        }));
      return { marketUnit, resolvedInt, live: true, items };
    }
  }

  const step = fallbackBucketStep(data.station.region, marketUnit);
  const ranges = fallbackBuckets(resolvedInt, step);
  return {
    marketUnit,
    resolvedInt,
    live: false,
    items: ranges.map((r, i) => ({
      label: formatBucketRange(r, marketUnit),
      target: i === 1,
      yesPrice: null,
    })),
  };
}

export function h6TargetC(data: StationPayload): number | null {
  const h6Id =
    data.station.h6Model ?? data.station.shortRange ?? data.forecast.primaryId;
  const h6 = data.forecast.models.find((m) => m.id === h6Id);
  const primary = data.forecast.models.find(
    (m) => m.id === data.forecast.primaryId,
  );
  return h6?.correctedMaxC ?? primary?.correctedMaxC ?? primary?.rawMaxC ?? null;
}
