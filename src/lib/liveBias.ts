import { cacheGet, cacheSet } from "./cache";
import { fetchWithBackoff } from "./http";
import type { MarketDay, PolymarketBucket } from "./types";

/**
 * Live, lead-aware bias corrections published daily by the weather-analysis
 * pipeline (VPS). For EDDM / LFPB / EGLC / EHAM it replaces the static seasonal
 * table: the bias is the walk-forward mean of past errors (forecast − METAR
 * daily max) of the run that was actually available at the consultation time,
 * cumulative or 30-day rolling depending on the lead. corrected = raw − bias.
 * Falls back to data/biases.seasonal.json when the file is missing, stale, or
 * has no entry for a model.
 */
export const LIVE_BIAS_URL =
  process.env.TMAX_LIVE_BIAS_URL ?? "http://34.245.85.250:5006/biais.json";
export const LIVE_BIAS_STATIONS = ["EDDM", "LFPB", "EGLC", "EHAM"] as const;
export const LIVE_BIAS_TTL_MS = 10 * 60 * 1000;
/** A file older than this is ignored (pipeline down): static table instead. */
export const LIVE_BIAS_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const CACHE_KEY = "live-bias";

export type LiveLead = "J0_08h" | "J0_10h30" | "J0_13h30" | "J1" | "J2";

interface LiveCorrection {
  bias: number;
  n: number;
}

export interface LiveForecast {
  lead: LiveLead;
  status: string;
  blend: number | null;
  mu: number | null;
  sd: number | null;
  /** Probability per integer °C of the METAR daily max (keys are integers). */
  probs: Record<string, number> | null;
  k_top: number | null;
  p_top: number | null;
  m_obs?: number | null;
  last_obs?: string | null;
}

interface LiveStation {
  updated_utc: string;
  local_time: string;
  slot: string;
  corrections: Record<string, Partial<Record<LiveLead, Record<string, LiveCorrection>>>>;
  forecast: Record<string, LiveForecast>;
}

export interface LiveBiasFile {
  version: number;
  generated_utc: string;
  methods?: Record<string, string>;
  stations: Record<string, LiveStation>;
}

export interface LiveBiasPayload {
  ok: boolean;
  url: string;
  generatedUtc?: string;
  error?: string;
  file?: LiveBiasFile;
}

/**
 * wstation model id → native models the pipeline corrects, in order. A
 * "seamless" series is its centre's native short-range run for the first
 * ~48 h (the static table already shows identical stats for icon_seamless /
 * icon_d2 and ukmo_seamless / UKV), then the coarser one, so the first native
 * model present for that station and lead is used.
 */
export const NATIVE_FOR: Record<string, string[]> = {
  icon_seamless: ["icon_d2", "icon_eu", "icon_global"],
  icon_d2: ["icon_d2"],
  icon_eu: ["icon_eu"],
  icon_global: ["icon_global"],
  ukmo_seamless: ["ukmo_uk_deterministic_2km", "ukmo_global_deterministic_10km"],
  ukmo_uk_deterministic_2km: ["ukmo_uk_deterministic_2km"],
  ukmo_global_deterministic_10km: ["ukmo_global_deterministic_10km"],
  meteofrance_seamless: ["meteofrance_arome_france_hd", "meteofrance_arpege_europe"],
  meteofrance_arome_france_hd: ["meteofrance_arome_france_hd"],
  meteofrance_arpege_europe: ["meteofrance_arpege_europe"],
  knmi_seamless: ["knmi_harmonie_arome_netherlands"],
  knmi_harmonie_arome_netherlands: ["knmi_harmonie_arome_netherlands"],
  dmi_harmonie_arome_europe: ["dmi_harmonie_arome_europe"],
  gem_seamless: ["gem_global"],
  gem_global: ["gem_global"],
  gfs_seamless: ["gfs_global"],
  gfs_global: ["gfs_global"],
  ecmwf_ifs025: ["ecmwf_ifs025"],
  ecmwf_ifs: ["ecmwf_ifs"],
  ecmwf_aifs025_single: ["ecmwf_aifs025_single"],
};

export function isLiveBiasStation(icao: string): boolean {
  return (LIVE_BIAS_STATIONS as readonly string[]).includes(icao.toUpperCase());
}

/**
 * Lead matching the consultation: today → the last of 08:00 / 10:30 / 13:30
 * local that has passed (08:00 before that), tomorrow → J1.
 */
export function leadFor(day: MarketDay, localIso: string): LiveLead {
  if (day === "tomorrow") return "J1";
  const hhmm = localIso.slice(11, 16);
  if (hhmm >= "13:30") return "J0_13h30";
  if (hhmm >= "10:30") return "J0_10h30";
  return "J0_08h";
}

export function parseLiveBias(json: unknown, nowMs = Date.now()): LiveBiasPayload {
  const file = json as LiveBiasFile;
  if (!file || typeof file !== "object" || !file.stations || !file.generated_utc) {
    return { ok: false, url: LIVE_BIAS_URL, error: "Malformed live bias file" };
  }
  const age = nowMs - Date.parse(file.generated_utc);
  if (!Number.isFinite(age) || age > LIVE_BIAS_MAX_AGE_MS) {
    return {
      ok: false,
      url: LIVE_BIAS_URL,
      generatedUtc: file.generated_utc,
      error: `Live bias file is stale (generated ${file.generated_utc})`,
    };
  }
  return { ok: true, url: LIVE_BIAS_URL, generatedUtc: file.generated_utc, file };
}

export async function fetchLiveBias(opts: { fresh?: boolean } = {}): Promise<LiveBiasPayload> {
  const hit = cacheGet<LiveBiasPayload>(CACHE_KEY, LIVE_BIAS_TTL_MS);
  if (hit?.fresh && !opts.fresh) return hit.value;
  try {
    const res = await fetchWithBackoff(LIVE_BIAS_URL, {}, { retries: 1, timeoutMs: 4_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = parseLiveBias(await res.json());
    if (payload.ok) cacheSet(CACHE_KEY, payload);
    return payload;
  } catch (error) {
    if (hit?.value.ok) {
      const again = parseLiveBias(hit.value.file);
      if (again.ok) return again;
    }
    return {
      ok: false,
      url: LIVE_BIAS_URL,
      error: `Live bias unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function liveBiasFailed(error: Error): LiveBiasPayload {
  return { ok: false, url: LIVE_BIAS_URL, error: `Live bias unavailable: ${error.message}` };
}

export interface LiveBiasHit {
  biasC: number;
  n: number;
  lead: LiveLead;
  nativeModel: string;
  method?: string;
}

export function liveBiasFor(
  live: LiveBiasPayload,
  icao: string,
  marketDate: string,
  lead: LiveLead,
  modelId: string,
): LiveBiasHit | null {
  if (!live.ok || !live.file) return null;
  const byLead = live.file.stations[icao.toUpperCase()]?.corrections?.[marketDate]?.[lead];
  if (!byLead) return null;
  for (const native of NATIVE_FOR[modelId] ?? []) {
    const c = byLead[native];
    if (c && Number.isFinite(c.bias)) {
      return {
        biasC: c.bias,
        n: c.n,
        lead,
        nativeModel: native,
        method: live.file.methods?.[lead],
      };
    }
  }
  return null;
}

export function liveForecastFor(
  live: LiveBiasPayload,
  icao: string,
  marketDate: string,
): LiveForecast | null {
  if (!live.ok || !live.file) return null;
  const f = live.file.stations[icao.toUpperCase()]?.forecast?.[marketDate];
  return f && f.status === "ok" && f.probs ? f : null;
}

/**
 * Bucket probabilities from the calibrated per-integer distribution (°C
 * markets): sum of P(k) over the integers of each bucket, tails included.
 */
export function bucketProbabilitiesFromLive(
  buckets: Array<Pick<PolymarketBucket, "lo" | "hi">>,
  probs: Record<string, number>,
): number[] {
  const entries = Object.entries(probs).map(([k, p]) => [Number(k), p] as const);
  return buckets.map((b) =>
    entries
      .filter(([k]) => (b.lo == null || k >= b.lo) && (b.hi == null || k <= b.hi))
      .reduce((s, [, p]) => s + p, 0),
  );
}
