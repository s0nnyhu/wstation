import { polymarketEventSlug } from "@/config/stations";
import { cacheGet, cacheSet, FRESH_MIN_AGE_MS, POLYMARKET_TTL_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import type { PolymarketBucket, PolymarketPayload, TempUnit } from "./types";

const USER_AGENT = "WStation/0.1 (local Polymarket weather dashboard)";
const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface GammaMarket {
  slug?: string;
  question?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  bestBid?: number;
  bestAsk?: number;
  active?: boolean;
  closed?: boolean;
}

interface GammaEvent {
  slug?: string;
  title?: string;
  description?: string;
  closed?: boolean;
  markets?: GammaMarket[];
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Gamma returns `outcomes` / `outcomePrices` as JSON-encoded string arrays. */
function yesPrice(market: GammaMarket): number | null {
  try {
    const outcomes = JSON.parse(market.outcomes ?? "[]") as string[];
    const prices = JSON.parse(market.outcomePrices ?? "[]") as string[];
    const idx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    const raw = Number(prices[idx === -1 ? 0 : idx]);
    return Number.isFinite(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Parse Polymarket bucket labels:
 *   "69°F or below" · "70-71°F" · "88°F or higher" · "23°C" · "-3°C"
 */
export function parseBucketLabel(
  label: string,
): Pick<PolymarketBucket, "lo" | "hi" | "unit"> | null {
  const text = label.replace(/\s+/g, " ").trim();
  let m = text.match(/^(-?\d+)°([CF]) or below$/i);
  if (m) return { lo: null, hi: Number(m[1]), unit: m[2].toUpperCase() as TempUnit };
  m = text.match(/^(-?\d+)°([CF]) or (?:higher|above)$/i);
  if (m) return { lo: Number(m[1]), hi: null, unit: m[2].toUpperCase() as TempUnit };
  m = text.match(/^(-?\d+)\s?(?:-|–|to)\s?(-?\d+)°([CF])$/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { lo: Math.min(a, b), hi: Math.max(a, b), unit: m[3].toUpperCase() as TempUnit };
  }
  m = text.match(/^(-?\d+)°([CF])$/i);
  if (m) return { lo: Number(m[1]), hi: Number(m[1]), unit: m[2].toUpperCase() as TempUnit };
  return null;
}

function resolutionHint(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const d = description.toLowerCase();
  if (d.includes("weather.gov")) return "NOAA weather.gov timeseries";
  if (d.includes("wunderground")) return "Weather Underground history";
  if (d.includes("noaa")) return "NOAA";
  return undefined;
}

function regularStep(buckets: PolymarketBucket[]): number | null {
  const widths = buckets
    .filter((b) => b.lo != null && b.hi != null)
    .map((b) => (b.hi as number) - (b.lo as number) + 1);
  if (widths.length === 0) return null;
  return Math.max(...widths);
}

function toPayload(
  event: GammaEvent,
  slug: string,
): PolymarketPayload {
  const buckets: PolymarketBucket[] = [];
  for (const market of event.markets ?? []) {
    const label = market.groupItemTitle?.trim() || market.question?.trim() || "";
    const parsed = parseBucketLabel(label);
    if (!parsed) continue;
    buckets.push({
      label,
      ...parsed,
      yesPrice: yesPrice(market),
      bestBid: finite(market.bestBid),
      bestAsk: finite(market.bestAsk),
      marketSlug: market.slug,
    });
  }
  buckets.sort((a, b) => {
    const ka = a.lo ?? (a.hi != null ? a.hi - 0.5 : -Infinity);
    const kb = b.lo ?? (b.hi != null ? b.hi - 0.5 : -Infinity);
    return ka - kb;
  });
  return {
    ok: buckets.length > 0,
    error: buckets.length > 0 ? undefined : "Event found but no parsable buckets",
    slug,
    url: `https://polymarket.com/event/${event.slug ?? slug}`,
    title: event.title,
    closed: event.closed,
    unit: buckets[0]?.unit ?? null,
    step: regularStep(buckets),
    buckets,
    resolutionHint: resolutionHint(event.description),
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

export function polymarketFailedPayload(
  icao: string,
  marketDate: string,
  error: unknown,
): PolymarketPayload {
  const slug = polymarketEventSlug(icao, marketDate) ?? "";
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Polymarket fetch failed",
    slug,
    url: slug ? `https://polymarket.com/event/${slug}` : undefined,
    unit: null,
    step: null,
    buckets: [],
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

export async function fetchPolymarketBuckets(
  icao: string,
  marketDate: string,
  opts: { fresh?: boolean } = {},
): Promise<PolymarketPayload> {
  const slug = polymarketEventSlug(icao, marketDate);
  if (!slug) {
    return polymarketFailedPayload(icao, marketDate, new Error(`No Polymarket city for ${icao}`));
  }

  const cacheKey = `pm:${slug}`;
  const cached = cacheGet<PolymarketPayload>(cacheKey, POLYMARKET_TTL_MS);
  if (cached?.fresh && !(opts.fresh && cached.ageMs > FRESH_MIN_AGE_MS)) {
    return { ...cached.value, stale: false };
  }

  try {
    const url = new URL(`${GAMMA_BASE}/events`);
    url.searchParams.set("slug", slug);
    const res = await fetchWithBackoff(
      url.toString(),
      { headers: { Accept: "application/json", "User-Agent": USER_AGENT } },
      { timeoutMs: 6_000, retries: 0 },
    );
    if (!res.ok) throw new Error(`Gamma HTTP ${res.status}`);
    const json = (await res.json()) as GammaEvent[];
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error(`No Polymarket event for ${slug}`);
    }
    const payload = toPayload(json[0], slug);
    if (payload.ok) cacheSet(cacheKey, payload);
    return payload;
  } catch (error) {
    if (cached) {
      return {
        ...cached.value,
        stale: true,
        error:
          error instanceof Error
            ? `Cached Polymarket (${error.message})`
            : "Cached Polymarket after upstream failure",
      };
    }
    return polymarketFailedPayload(icao, marketDate, error);
  }
}