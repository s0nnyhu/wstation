import { formatTemp } from "./units";
import { h6TargetC, suggestBuckets } from "./buckets";
import type {
  ModelRow,
  PolymarketBucket,
  StationPayload,
  TempUnit,
} from "./types";

export function formatClientNow(now: Date): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const tz =
    new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return tz ? `${date} ${time} ${tz}` : `${date} ${time}`;
}

export function pickPolymarketFavorite(
  buckets: PolymarketBucket[],
): PolymarketBucket | null {
  let best: PolymarketBucket | null = null;
  for (const bucket of buckets) {
    if (bucket.yesPrice == null) continue;
    if (best?.yesPrice == null || bucket.yesPrice > best.yesPrice) {
      best = bucket;
    }
  }
  return best;
}

function formatFavorite(bucket: PolymarketBucket | null): string {
  if (!bucket) return "—";
  if (bucket.yesPrice == null) return bucket.label;
  return `${bucket.label} (${Math.round(bucket.yesPrice * 100)}¢)`;
}

function formatModelLine(row: ModelRow, unit: TempUnit): string | null {
  if (row.role !== "primary" && row.role !== "backup") return null;
  return `${row.label} (${row.role}) ${formatTemp(row.correctedMaxC, unit, 1)}`;
}

function formatH6Line(data: StationPayload): string {
  const buckets = suggestBuckets(data, h6TargetC(data));
  if (!buckets.items.length) return "H-6 —";
  const labels = buckets.items.map((b) => b.label).join(" · ");
  if (buckets.resolvedInt == null) return `H-6 ${labels}`;
  return `H-6 ${buckets.resolvedInt}°${buckets.marketUnit} (${labels})`;
}

export function formatStationClipboard(
  data: StationPayload,
  unit: TempUnit,
  now: Date,
): string {
  const favorite = data.polymarket.ok
    ? pickPolymarketFavorite(data.polymarket.buckets)
    : null;
  const models = data.forecast.models
    .map((row) => formatModelLine(row, unit))
    .filter((line): line is string => line != null);
  return [
    `${data.station.name} (${data.station.icao})`,
    formatClientNow(now),
    `WU ${formatTemp(data.wu.ok ? data.wu.dailyMaxC : null, unit, 1)}`,
    `Husky ${formatTemp(data.husky.ok ? data.husky.dailyMaxC : null, unit, 1)}`,
    ...models,
    formatH6Line(data),
    `Favorite ${formatFavorite(favorite)}`,
  ].join("\n");
}
