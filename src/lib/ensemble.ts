import { cacheGet, cacheSet } from "./cache";
import { fetchWithBackoff } from "./http";
import { normalCdf } from "./units";
import type { MarketDay, PolymarketBucket } from "./types";

/**
 * Calibrated multi-model forecast of the METAR daily max, computed live from
 * the "recipe" the weather-analysis pipeline (VPS) publishes three times a day
 * in biais.json: per-model walk-forward bias corrections, blend membership and
 * weights, and the NGR distribution fitted on all data up to yesterday.
 *
 * The maths mirrors weather-analysis/recipe.py exactly (parity-tested in
 * ensemble.test.ts against the pipeline's own output).
 */
export const RECIPE_URL =
  process.env.TMAX_LIVE_BIAS_URL ?? "http://34.245.85.250:5006/biais.json";
export const RECIPE_TTL_MS = 10 * 60 * 1000;
/** Ignore a file older than this (pipeline down). */
export const RECIPE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
/** A recipe from an earlier day can stand in for today's for at most this many days. */
export const RECIPE_MAX_LAG_DAYS = 2;
const CACHE_KEY = "ensemble-recipe:v2";

export type Lead = "J0_08h" | "J0_10h30" | "J0_13h30" | "J1" | "J2";

export const LEAD_LABEL: Record<Lead, string> = {
  J0_08h: "today, 08:00 issue",
  J0_10h30: "today, 10:30 issue",
  J0_13h30: "today, 13:30 issue",
  J1: "day ahead (J1)",
  J2: "two days ahead (J2)",
};

export interface RecipeModel {
  bias: number;
  n: number;
  mse_exp: number | null;
  mse_r30: number | null;
}

export interface Recipe {
  correction_method: string;
  blend: { method: "mean" | "best" | "invmse_exp" | "invmse_roll30"; size: "all" | "top3" | "top5" | "-" };
  models: Record<string, RecipeModel>;
  family_drop: Array<{ a: string; b: string; drop: string }>;
  distribution: {
    kind: "ngr_spread" | "ngr_nospread";
    a: number;
    b: number;
    c: number;
    d: number;
    fit: string;
    n: number;
    fitted_through?: string;
  } | null;
  metar_constraint: "troncature" | null;
}

export interface Discretization {
  round_var: number;
  min_var: number;
  floor: number;
  window: number;
}

export interface RecipeFile {
  version: number;
  recipe_version?: number;
  generated_utc: string;
  discretization: Discretization;
  model_delays_h?: Record<string, number>;
  stations: Record<string, { recipes?: Record<string, Partial<Record<Lead, Recipe>>> }>;
}

export interface RecipeFetch {
  ok: boolean;
  url: string;
  generatedUtc?: string;
  error?: string;
  file?: RecipeFile;
}

// ------------------------------------------------------------------ fetch

export function parseRecipeFile(json: unknown, nowMs = Date.now()): RecipeFetch {
  const file = json as RecipeFile;
  if (!file || typeof file !== "object" || !file.stations || !file.generated_utc || !file.discretization) {
    return { ok: false, url: RECIPE_URL, error: "Malformed recipe file" };
  }
  const age = nowMs - Date.parse(file.generated_utc);
  if (!Number.isFinite(age) || age > RECIPE_MAX_AGE_MS) {
    return {
      ok: false,
      url: RECIPE_URL,
      generatedUtc: file.generated_utc,
      error: `Recipe file is stale (generated ${file.generated_utc})`,
    };
  }
  return { ok: true, url: RECIPE_URL, generatedUtc: file.generated_utc, file };
}

export async function fetchRecipeFile(opts: { fresh?: boolean } = {}): Promise<RecipeFetch> {
  const hit = cacheGet<RecipeFetch>(CACHE_KEY, RECIPE_TTL_MS);
  if (hit?.fresh && !opts.fresh) return hit.value;
  try {
    const res = await fetchWithBackoff(RECIPE_URL, {}, { retries: 1, timeoutMs: 4_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = parseRecipeFile(await res.json());
    if (payload.ok) cacheSet(CACHE_KEY, payload);
    return payload;
  } catch (error) {
    if (hit?.value.file) {
      const again = parseRecipeFile(hit.value.file);
      if (again.ok) return again;
    }
    return {
      ok: false,
      url: RECIPE_URL,
      error: `Recipe unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function recipeFailed(error: Error): RecipeFetch {
  return { ok: false, url: RECIPE_URL, error: `Recipe unavailable: ${error.message}` };
}

// ------------------------------------------------------------------ lead & recipe lookup

/** Today → last of 08:00 / 10:30 / 13:30 local that has passed (08:00 before); tomorrow → J1. */
export function leadFor(day: MarketDay, localIso: string): Lead {
  if (day === "tomorrow") return "J1";
  const hhmm = localIso.slice(11, 16);
  if (hhmm >= "13:30") return "J0_13h30";
  if (hhmm >= "10:30") return "J0_10h30";
  return "J0_08h";
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * Recipe for (station, market date, lead). The pipeline publishes J0 recipes
 * at 08:00 local, so just after midnight today's J0 recipe is not out yet: the
 * latest earlier one for the same lead (≤ RECIPE_MAX_LAG_DAYS old) is used and
 * flagged — corrections move by hundredths of a degree from one day to the next.
 */
export function findRecipe(
  fetched: RecipeFetch,
  icao: string,
  marketDate: string,
  lead: Lead,
): { recipe: Recipe; recipeDate: string } | null {
  const recipes = fetched.ok ? fetched.file?.stations[icao.toUpperCase()]?.recipes : undefined;
  if (!recipes) return null;
  const exact = recipes[marketDate]?.[lead];
  if (exact) return { recipe: exact, recipeDate: marketDate };
  const older = Object.keys(recipes)
    .filter((d) => d < marketDate && dayDiff(marketDate, d) <= RECIPE_MAX_LAG_DAYS && recipes[d]?.[lead])
    .sort()
    .pop();
  return older ? { recipe: recipes[older]![lead]!, recipeDate: older } : null;
}

// ------------------------------------------------------------------ raw Tmax (same rule as the pipeline)

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/** UTC epoch ms of local midnight starting `dateLocal` in `timeZone` (DST-aware). */
export function localMidnightUtcMs(dateLocal: string, timeZone: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - tzOffsetMs(naive, timeZone);
  guess = naive - tzOffsetMs(guess, timeZone);
  return guess;
}

/** UTC hours (epoch s) of the local day: 23, 24 or 25 of them. */
export function localDayHoursUtc(dateLocal: string, timeZone: string): number[] {
  const start = localMidnightUtcMs(dateLocal, timeZone);
  const [y, m, d] = dateLocal.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const end = localMidnightUtcMs(next, timeZone);
  const out: number[] = [];
  for (let t = start; t < end; t += 3_600_000) out.push(t / 1000);
  return out;
}

/**
 * Initialisation of the run behind the forecast: meta.json when it is less than
 * 36 h old, else the latest 00Z/12Z run with init + publication delay ≤ now.
 */
export function effectiveInitUnix(
  metaInitIso: string | null | undefined,
  delayH: number | undefined,
  nowMs = Date.now(),
): number {
  if (metaInitIso) {
    const t = Date.parse(metaInitIso);
    if (Number.isFinite(t) && nowMs - t < 36 * 3_600_000) return t / 1000;
  }
  const d = (delayH ?? 6) * 3_600_000;
  const base = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  );
  for (let k = 0; k < 6; k++) {
    const init = base - 12 * 3_600_000 * k;
    if (init + d <= nowMs) return init / 1000;
  }
  return (base - 72 * 3_600_000) / 1000;
}

const ISSUE_HHMM: Partial<Record<Lead, [number, number]>> = {
  J0_08h: [8, 0],
  J0_10h30: [10, 30],
  J0_13h30: [13, 30],
};

/**
 * Start of the hourly window for today's raw max. The pipeline computes J0 at
 * 08:00 / 10:30 / 13:30, when the newest run still starts before the afternoon
 * peak. Consulted later, the newest run can start after the peak, and "hours at
 * or after init" would keep only the evening. So for today the window starts no
 * later than the latest 00Z/12Z run available at the lead's issue time; earlier
 * hours of the Open-Meteo series are the most recent forecast for each hour, and
 * outcomes below the METAR high are excluded anyway.
 */
export function windowStartUnix(
  lead: Lead,
  dateLocal: string,
  timeZone: string,
  initUnix: number,
  delayH: number | undefined,
): number {
  const hhmm = ISSUE_HHMM[lead];
  if (!hhmm) return initUnix;
  const issueMs = localMidnightUtcMs(dateLocal, timeZone) + (hhmm[0] * 60 + hhmm[1]) * 60_000;
  return Math.min(initUnix, effectiveInitUnix(null, delayH, issueMs));
}

/**
 * Raw daily max of one model: max hourly temperature over the local day's hours
 * at or after the run's initialisation; every one of those hours must be present.
 */
export function rawTmax(
  timesUnix: number[],
  temps: Array<number | null>,
  dateLocal: string,
  timeZone: string,
  initUnix: number,
): number | null {
  const byTime = new Map<number, number | null>();
  timesUnix.forEach((t, i) => byTime.set(t, temps[i] ?? null));
  const hours = localDayHoursUtc(dateLocal, timeZone).filter((h) => h >= initUnix);
  if (!hours.length) return null;
  let max = -Infinity;
  for (const h of hours) {
    const v = byTime.get(h);
    if (v == null || !Number.isFinite(v)) return null;
    if (v > max) max = v;
  }
  return max;
}

// ------------------------------------------------------------------ recipe → blend → distribution

export type MemberStatus = "selected" | "eligible" | "redundant" | "no-skill-yet" | "no-correction" | "missing";

export interface EnsembleRow {
  model: string;
  raw: number | null;
  biasC: number | null;
  n: number | null;
  corrected: number | null;
  status: MemberStatus;
  weight: number | null;
}

export interface EnsembleResult {
  blendC: number;
  blendRawC: number;
  spreadC: number | null;
  rows: EnsembleRow[];
  selected: string[];
  eligible: string[];
  mu: number | null;
  sd: number | null;
  /** P(METAR daily max = k °C), k ascending, p ≥ 0.001. */
  probs: Array<{ k: number; p: number }>;
  kTop: number | null;
  pTop: number | null;
  /** Central ~80 % range of the integer outcome. */
  range80: { lo: number; hi: number } | null;
  truncatedAt: number | null;
}

const K_MIN = -30;
const K_MAX = 50;

export function applyRecipe(
  recipe: Recipe,
  raws: Record<string, number | null>,
  disc: Discretization,
  mObs: number | null,
): EnsembleResult | null {
  const rows = new Map<string, { raw: number; corrected: number; m: RecipeModel }>();
  for (const [model, m] of Object.entries(recipe.models)) {
    const raw = raws[model];
    if (raw == null || !Number.isFinite(raw)) continue;
    rows.set(model, { raw, corrected: raw - m.bias, m });
  }
  // A same-family pair is de-duplicated only when both models have a forecast.
  const dropped = new Set(
    recipe.family_drop.filter((f) => rows.has(f.a) && rows.has(f.b)).map((f) => f.drop),
  );
  const eligible = [...rows.entries()]
    .filter(([id, r]) => r.m.mse_exp != null && !dropped.has(id))
    .sort((a, b) => (a[1].m.mse_exp as number) - (b[1].m.mse_exp as number))
    .map(([id]) => id);
  if (!eligible.length) return null;

  const vals = eligible.map((id) => rows.get(id)!.corrected);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const spreadC =
    vals.length > 1 ? Math.sqrt(mean(vals.map((v) => (v - mean(vals)) ** 2))) : null;

  const { method, size } = recipe.blend;
  const k =
    method === "best" ? 1 : size === "top3" ? 3 : size === "top5" ? 5 : size === "all" ? eligible.length : 1;
  const selected = eligible.slice(0, k);
  const sv = selected.map((id) => rows.get(id)!.corrected);
  let weights: number[] | null = null;
  if (method === "invmse_exp" || method === "invmse_roll30") {
    const w = selected.map((id) => {
      const m = rows.get(id)!.m;
      const mse = method === "invmse_exp" ? m.mse_exp : (m.mse_r30 ?? m.mse_exp);
      return 1 / (mse as number);
    });
    if (w.every((x) => Number.isFinite(x))) weights = w;
  }
  const blendC = weights
    ? sv.reduce((s, v, i) => s + v * weights![i], 0) / weights.reduce((s, x) => s + x, 0)
    : mean(sv);
  const blendRawC = mean(selected.map((id) => rows.get(id)!.raw));
  const wsum = weights ? weights.reduce((s, x) => s + x, 0) : selected.length;

  const outRows: EnsembleRow[] = Object.keys(recipe.models).map((model) => {
    const m = recipe.models[model];
    const r = rows.get(model);
    const i = selected.indexOf(model);
    const status: MemberStatus = !r
      ? "missing"
      : i >= 0
        ? "selected"
        : dropped.has(model)
          ? "redundant"
          : m.mse_exp == null
            ? "no-skill-yet"
            : "eligible";
    return {
      model,
      raw: r?.raw ?? null,
      biasC: m.bias,
      n: m.n,
      corrected: r?.corrected ?? null,
      status,
      weight: i >= 0 ? (weights ? weights[i] : 1) / wsum : null,
    };
  });

  const base: EnsembleResult = {
    blendC,
    blendRawC,
    spreadC,
    rows: outRows,
    selected,
    eligible,
    mu: null,
    sd: null,
    probs: [],
    kTop: null,
    pTop: null,
    range80: null,
    truncatedAt: null,
  };
  const d = recipe.distribution;
  if (!d) return base;

  const mu = d.a + d.b * blendC;
  const sd = Math.sqrt(d.c + d.d * (spreadC ?? 0) ** 2);
  const sb = Math.sqrt(Math.max(sd ** 2 - disc.round_var, disc.min_var));
  const ks: number[] = [];
  for (let kk = K_MIN; kk <= K_MAX; kk++) ks.push(kk);
  let P = ks.map((kk, i) => {
    const lo = i === 0 ? 0 : normalCdf((kk - 0.5 - mu) / sb);
    const hi = i === ks.length - 1 ? 1 : normalCdf((kk + 0.5 - mu) / sb);
    return hi - lo;
  });
  const truncate = mObs != null && recipe.metar_constraint === "troncature";
  if (truncate) {
    P = P.map((p, i) => (ks[i] < mObs! ? 0 : p));
    const s = P.reduce((a, b) => a + b, 0);
    if (s > 0) P = P.map((p) => p / s);
  }
  let mode = 0;
  P.forEach((p, i) => {
    if (p > P[mode]) mode = i;
  });
  P = P.map((p, i) =>
    Math.abs(i - mode) <= disc.window && (!truncate || ks[i] >= mObs!) ? Math.max(p, disc.floor) : p,
  );
  const total = P.reduce((a, b) => a + b, 0);
  P = P.map((p) => p / total);

  let cum = 0;
  let lo: number | null = null;
  let hi: number | null = null;
  ks.forEach((kk, i) => {
    cum += P[i];
    if (lo == null && cum >= 0.1) lo = kk;
    if (hi == null && cum >= 0.9) hi = kk;
  });

  return {
    ...base,
    mu,
    sd,
    probs: ks.map((kk, i) => ({ k: kk, p: P[i] })).filter((x) => x.p >= 0.001),
    kTop: ks[mode],
    pTop: P[mode],
    range80: lo != null && hi != null ? { lo, hi } : null,
    truncatedAt: truncate ? mObs : null,
  };
}

/** Sum of P(k) over the integers of each Polymarket bucket (°C markets), tails included. */
export function bucketProbabilities(
  buckets: Array<Pick<PolymarketBucket, "lo" | "hi">>,
  probs: Array<{ k: number; p: number }>,
): number[] {
  return buckets.map((b) =>
    probs
      .filter(({ k }) => (b.lo == null || k >= b.lo) && (b.hi == null || k <= b.hi))
      .reduce((s, { p }) => s + p, 0),
  );
}
