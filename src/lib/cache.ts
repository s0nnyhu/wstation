export interface CacheEntry<T> {
  value: T;
  at: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const FORECAST_TTL_MS = 12 * 60 * 1000;
export const METAR_TTL_MS = 2 * 60 * 1000;
export const WU_TTL_MS = 3 * 60 * 1000;
export const HUSKY_TTL_MS = 3 * 60 * 1000;
export const POLYMARKET_TTL_MS = 60 * 1000;
export const SYNOPTIC_TTL_MS = 2 * 60 * 1000;
export const STALE_MAX_MS = 2 * 60 * 60 * 1000;
export const FRESH_MIN_AGE_MS = 30 * 1000;

export function cacheGet<T>(
  key: string,
  ttlMs: number,
): { value: T; ageMs: number; fresh: boolean } | undefined {
  const hit = store.get(key) as CacheEntry<T> | undefined;
  if (!hit) return undefined;
  const ageMs = Date.now() - hit.at;
  if (ageMs > STALE_MAX_MS) {
    store.delete(key);
    return undefined;
  }
  return { value: hit.value, ageMs, fresh: ageMs <= ttlMs };
}

export function cacheSet<T>(key: string, value: T): void {
  store.set(key, { value, at: Date.now() });
}