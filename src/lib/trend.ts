import { metarBodyTokens } from "./metarDecode";
import { modelFamily } from "./models";
import type { HourlyPoint, MetarPayload } from "./types";

/**
 * Short-term temperature outlook for the market day: will it keep warming,
 * hold, cool, or is the situation too unstable to say? Combines the model
 * hourly curves (one vote per family, re-anchored on the last METAR), the
 * observed METAR slope, and instability signals (model split, showers or
 * thunder, sudden jumps, observations going against the models).
 */
export type TrendState = "warming" | "holding" | "cooling" | "unstable";

export type TrendReason =
  | { kind: "split"; loC: number; hiC: number; at: string }
  | { kind: "convective-now" }
  | { kind: "convective-soon"; at: string; prob: number | null }
  | { kind: "jump"; deltaC: number; minutes: number }
  | { kind: "contradiction" };

export interface TrendPayload {
  state: TrendState;
  confidence: "high" | "medium" | "low";
  /** Median model change from the last METAR to `horizon` (station-local HH:MM). */
  changeC: number | null;
  horizon: string | null;
  /** Model families whose change falls in the same class as the median. */
  agree: number;
  families: number;
  /** Least-squares METAR slope over the last ~100 min, °C per hour. */
  obsSlopeCPerH: number | null;
  /** Station-local HH:MM of the median model peak still ahead today. */
  peakAt: string | null;
  peakPassed: boolean;
  /** Re-anchored median remaining max minus today's METAR max. */
  upsideVsMaxC: number | null;
  reasons: TrendReason[];
}

/** Change (°C) at which the outlook is no longer "holding". */
const MOVE_C = 0.5;
const HORIZON_H = 2;
const PEAK_MIN_RISE_C = 0.3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const classOf = (d: number): Exclude<TrendState, "unstable"> =>
  d >= MOVE_C ? "warming" : d <= -MOVE_C ? "cooling" : "holding";

const hhmm = (h: number) => {
  const total = Math.round(h * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Station-local fractional hour of a UTC instant. */
function localHour(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return get("hour") + get("minute") / 60;
}

/** Hour-of-day → value curve per model family (median of the family's members). */
function familyCurves(hourly: HourlyPoint[]): Map<string, Map<number, number>> {
  const byFamily = new Map<string, Map<number, number[]>>();
  for (const point of hourly) {
    const hour = Number(point.time.slice(11, 13));
    for (const [id, v] of Object.entries(point.tempsC)) {
      if (v == null || !Number.isFinite(v)) continue;
      const fam = modelFamily(id);
      const hours = byFamily.get(fam) ?? new Map<number, number[]>();
      hours.set(hour, [...(hours.get(hour) ?? []), v]);
      byFamily.set(fam, hours);
    }
  }
  const out = new Map<string, Map<number, number>>();
  for (const [fam, hours] of byFamily) {
    out.set(fam, new Map([...hours].map(([h, vs]) => [h, median(vs)])));
  }
  return out;
}

function at(curve: Map<number, number>, h: number): number | null {
  const lo = Math.floor(h);
  const hi = Math.min(23, Math.ceil(h));
  const a = curve.get(lo);
  const b = curve.get(hi);
  if (a == null || b == null) return null;
  return a + (b - a) * (h - lo);
}

function obsSlope(points: Array<{ ms: number; tempC: number }>): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1].ms;
  const recent = points.filter((p) => last - p.ms <= 100 * 60_000);
  if (recent.length < 2 || last - recent[0].ms < 45 * 60_000) return null;
  const xs = recent.map((p) => (p.ms - last) / 3_600_000);
  const ys = recent.map((p) => p.tempC);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
}

export function buildTrend(input: {
  hourly: HourlyPoint[];
  metar: MetarPayload;
  timezone: string;
  nowMs: number;
}): TrendPayload | null {
  const { hourly, metar, timezone, nowMs } = input;
  const latest = metar.ok ? metar.latest : undefined;
  if (!latest || hourly.length === 0) return null;

  const obsMs = Date.parse(latest.observedAt);
  const obsH = localHour(obsMs, timezone);
  const nowH = localHour(nowMs, timezone);
  // Overnight wrap (obs before midnight, now after): outlook covers today only.
  if (nowH < obsH - 12) return null;
  const endH = Math.min(23, nowH + HORIZON_H);

  const curves = familyCurves(hourly);
  const changes: number[] = [];
  const upsides: number[] = [];
  const anchored = new Map<string, Map<number, number>>();
  for (const [fam, curve] of curves) {
    const base = at(curve, obsH);
    const end = at(curve, endH);
    if (base == null || end == null) continue;
    changes.push(end - base);
    const ahead = [nowH, ...[...curve.keys()].filter((h) => h > nowH)]
      .map((h) => at(curve, h))
      .filter((v): v is number => v != null);
    upsides.push(Math.max(...ahead) - base);
    anchored.set(fam, new Map([...curve].map(([h, v]) => [h, v - base + latest.tempC])));
  }

  const strip = (metar.observations ?? []).map((o) => ({ ms: Date.parse(o.at), tempC: o.tempC }));
  const slope = obsSlope(strip);
  if (changes.length === 0 && slope == null) return null;

  const changeC = changes.length ? median(changes) : null;
  const modelClass = changeC != null ? classOf(changeC) : null;
  const agree = modelClass ? changes.filter((d) => classOf(d) === modelClass).length : 0;
  const agreeRatio = changes.length ? agree / changes.length : 0;

  // Median family curve ahead, re-anchored on the last METAR: where is the peak?
  let peakAt: string | null = null;
  let peakPassed = false;
  if (anchored.size) {
    const hours = [...new Set([...anchored.values()].flatMap((c) => [...c.keys()]))]
      .filter((h) => h > nowH)
      .sort((a, b) => a - b);
    const med = (h: number) => median([...anchored.values()].map((c) => at(c, h)).filter((v): v is number => v != null));
    const nowVal = med(nowH);
    let best = { h: nowH, v: nowVal };
    for (const h of hours) {
      const v = med(h);
      if (v > best.v) best = { h, v };
    }
    // A peak "ahead" must be a real rise, not a flat curve's noise.
    if (best.v - nowVal < PEAK_MIN_RISE_C) best = { h: nowH, v: nowVal };
    peakPassed = hours.length > 0 && best.h === nowH;
    peakAt = hours.length > 0 && !peakPassed ? hhmm(best.h) : null;
  }
  const upsideVsMaxC =
    upsides.length && metar.runningMaxC != null
      ? latest.tempC + median(upsides) - metar.runningMaxC
      : null;

  // ---- instability signals ------------------------------------------------
  const reasons: TrendReason[] = [];
  let worstSplit: { lo: number; hi: number; h: number } | null = null;
  for (let h = Math.ceil(nowH); h <= Math.min(23, nowH + 3); h++) {
    const vals = [...anchored.values()].map((c) => c.get(h)).filter((v): v is number => v != null);
    if (vals.length < 2) continue;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (!worstSplit || hi - lo > worstSplit.hi - worstSplit.lo) worstSplit = { lo, hi, h };
  }
  if (worstSplit && worstSplit.hi - worstSplit.lo >= 3) {
    reasons.push({ kind: "split", loC: worstSplit.lo, hiC: worstSplit.hi, at: hhmm(worstSplit.h) });
  }

  const tokens = metarBodyTokens(latest.raw).slice(2);
  const convectiveNow = tokens.some(
    (t) => /^(RE)?(-|\+|VC)?(TS|SH)/.test(t) || /^(FEW|SCT|BKN|OVC)\d{3}(CB|TCU)$/.test(t),
  );
  if (convectiveNow) reasons.push({ kind: "convective-now" });
  const soon = hourly.find((p) => {
    const h = Number(p.time.slice(11, 13));
    if (h <= nowH || h > nowH + 3) return false;
    // Showers/thunder codes need some probability behind them; any rain needs a lot.
    const prob = p.precipProb;
    const showers = p.weatherCode != null && p.weatherCode >= 80 && (prob == null || prob >= 30);
    return showers || (prob ?? 0) >= 60;
  });
  if (soon) reasons.push({ kind: "convective-soon", at: soon.time.slice(11, 16), prob: soon.precipProb });

  const lastMs = strip.length ? strip[strip.length - 1].ms : 0;
  for (let i = strip.length - 1; i > 0; i--) {
    const a = strip[i - 1];
    const b = strip[i];
    if (lastMs - b.ms > 120 * 60_000) break;
    const minutes = (b.ms - a.ms) / 60_000;
    const jump = b.tempC - a.tempC;
    // A fast drop the models also expect (evening radiative cooling) is not chaos.
    const expected = modelClass === (jump > 0 ? "warming" : "cooling");
    if (minutes <= 45 && Math.abs(jump) >= 2 && !expected) {
      reasons.push({ kind: "jump", deltaC: jump, minutes: Math.round(minutes) });
      break;
    }
  }

  const contradiction =
    slope != null &&
    changeC != null &&
    Math.abs(slope) >= 1 &&
    Math.abs(changeC) >= 1 &&
    Math.sign(slope) !== Math.sign(changeC);
  if (contradiction) reasons.push({ kind: "contradiction" });

  const changeRange = changes.length ? Math.max(...changes) - Math.min(...changes) : 0;
  const unstable =
    reasons.some((r) => r.kind === "split" || r.kind === "jump" || r.kind === "contradiction") ||
    ((convectiveNow || soon != null) && (agreeRatio < 0.75 || changeRange >= 2));

  const state: TrendState = unstable
    ? "unstable"
    : (modelClass ?? (slope == null ? "holding" : classOf(slope)));
  const confidence: TrendPayload["confidence"] =
    state === "unstable" || changes.length === 0
      ? "low"
      : changes.length >= 3 && agreeRatio >= 0.8 && !convectiveNow && !soon
        ? "high"
        : agreeRatio >= 0.6
          ? "medium"
          : "low";

  return {
    state,
    confidence,
    changeC,
    // Quarter-hour display: "by 22:00", not "by 22:02".
    horizon: changes.length ? hhmm(Math.round(endH * 4) / 4) : null,
    agree,
    families: changes.length,
    obsSlopeCPerH: slope,
    peakAt,
    peakPassed,
    upsideVsMaxC,
    reasons,
  };
}
