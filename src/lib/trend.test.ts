import { describe, expect, it } from "vitest";
import { buildTrend } from "./trend";
import type { HourlyPoint, MetarPayload } from "./types";

const TZ = "Europe/Paris"; // UTC+2 on 12 Oct 2026

type Curve = (h: number) => number;

function hourly(curves: Record<string, Curve>, extra: (h: number) => Partial<HourlyPoint> = () => ({})): HourlyPoint[] {
  return Array.from({ length: 24 }, (_, h) => ({
    time: `2026-10-12T${String(h).padStart(2, "0")}:00`,
    tempsC: Object.fromEntries(Object.entries(curves).map(([id, f]) => [id, f(h)])),
    precipProb: 5,
    cloudCover: 20,
    weatherCode: 1,
    precipMm: 0,
    rainMm: 0,
    windSpeedMps: 3,
    windGustMps: 5,
    windDirDeg: 200,
    shortwaveWm2: 300,
    humidityPct: 60,
    ...extra(h),
  }));
}

/** Diurnal curve peaking at `peak` local hour with `max` °C. */
const diurnal = (max: number, peak = 15, amp = 8): Curve => (h) =>
  max - amp * ((h - peak) / 9) ** 2;

function metar(obs: Array<[string, number]>, raw = "METAR LFPB 120930Z AUTO 18008KT CAVOK 18/08 Q1019", runningMaxC?: number): MetarPayload {
  const [lastAt, lastC] = obs[obs.length - 1];
  return {
    ok: true,
    latest: { tempC: lastC, tempBodyC: lastC, dewpointC: 8, observedAt: lastAt, raw },
    observations: obs.map(([at, tempC]) => ({ at, tempC, icon: "clear" })),
    runningMaxC: runningMaxC ?? Math.max(...obs.map(([, t]) => t)),
    fetchedAt: lastAt,
    stale: false,
  };
}

const RISING: Array<[string, number]> = [
  ["2026-10-12T08:00:00Z", 15],
  ["2026-10-12T08:30:00Z", 16],
  ["2026-10-12T09:00:00Z", 17],
  ["2026-10-12T09:30:00Z", 17],
];
const NOON = Date.parse("2026-10-12T10:00:00Z"); // 12:00 Paris

describe("buildTrend", () => {
  it("still warming when every family keeps rising", () => {
    const t = buildTrend({
      hourly: hourly({ icon_seamless: diurnal(20), gfs_seamless: diurnal(21), ecmwf_ifs025: diurnal(19.5) }),
      metar: metar(RISING),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.state).toBe("warming");
    expect(t.confidence).toBe("high");
    expect(t.agree).toBe(3);
    expect(t.families).toBe(3);
    expect(t.horizon).toBe("14:00");
    expect(t.changeC).toBeGreaterThan(1);
    expect(t.peakAt).toBe("15:00");
    expect(t.peakPassed).toBe(false);
    expect(t.obsSlopeCPerH).toBeGreaterThan(1);
    expect(t.upsideVsMaxC).toBeGreaterThan(1);
    expect(t.reasons).toEqual([]);
  });

  it("counts one vote per family", () => {
    const t = buildTrend({
      hourly: hourly({ icon_seamless: diurnal(20), icon_d2: diurnal(20.2), gfs_seamless: diurnal(21) }),
      metar: metar(RISING),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.families).toBe(2);
  });

  it("cooling after the peak", () => {
    const evening = Date.parse("2026-10-12T17:00:00Z"); // 19:00 Paris
    const t = buildTrend({
      hourly: hourly({ icon_seamless: diurnal(20), gfs_seamless: diurnal(21) }),
      metar: metar([
        ["2026-10-12T16:00:00Z", 19],
        ["2026-10-12T16:30:00Z", 18],
        ["2026-10-12T17:00:00Z", 18],
      ]),
      timezone: TZ,
      nowMs: evening,
    })!;
    expect(t.state).toBe("cooling");
    expect(t.peakPassed).toBe(true);
    expect(t.peakAt).toBeNull();
    expect(t.upsideVsMaxC).toBeLessThanOrEqual(0);
  });

  it("holding on a flat curve", () => {
    const flat: Curve = () => 12;
    const t = buildTrend({
      hourly: hourly({ icon_seamless: flat, gfs_seamless: (h) => 12 + 0.05 * h }),
      metar: metar([
        ["2026-10-12T08:30:00Z", 12],
        ["2026-10-12T09:30:00Z", 12],
      ]),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.state).toBe("holding");
  });

  it("unstable when models split by 3 °C or more", () => {
    const t = buildTrend({
      hourly: hourly({
        icon_seamless: diurnal(20),
        gfs_seamless: (h) => (h >= 13 ? 14 : diurnal(20)(h)),
        ecmwf_ifs025: diurnal(20),
      }),
      metar: metar(RISING),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.state).toBe("unstable");
    expect(t.confidence).toBe("low");
    expect(t.reasons[0]).toMatchObject({ kind: "split", at: "15:00" });
  });

  it("unstable with showers ahead and models disagreeing", () => {
    const t = buildTrend({
      hourly: hourly(
        { icon_seamless: diurnal(20), gfs_seamless: (h) => (h >= 13 ? 16.5 : diurnal(20)(h)) },
        (h) => (h === 13 ? { weatherCode: 81, precipProb: 55 } : {}),
      ),
      metar: metar(RISING),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.state).toBe("unstable");
    expect(t.reasons).toContainEqual({ kind: "convective-soon", at: "13:00", prob: 55 });
  });

  it("ignores a shower code with a negligible probability", () => {
    const t = buildTrend({
      hourly: hourly(
        { icon_seamless: diurnal(20), gfs_seamless: diurnal(20.5) },
        (h) => (h === 13 ? { weatherCode: 80, precipProb: 3 } : {}),
      ),
      metar: metar(RISING),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.reasons).toEqual([]);
    expect(t.state).toBe("warming");
  });

  it("flags thunder at the airport and sudden jumps", () => {
    const t = buildTrend({
      hourly: hourly({ icon_seamless: diurnal(20), gfs_seamless: diurnal(20) }),
      metar: metar(
        [
          ["2026-10-12T09:00:00Z", 19],
          ["2026-10-12T09:30:00Z", 16],
        ],
        "METAR LFPB 120930Z 25015G30KT 3000 +TSRA BKN030CB 16/14 Q1012",
      ),
      timezone: TZ,
      nowMs: NOON,
    })!;
    expect(t.state).toBe("unstable");
    expect(t.reasons).toContainEqual({ kind: "convective-now" });
    expect(t.reasons).toContainEqual({ kind: "jump", deltaC: -3, minutes: 30 });
  });

  it("a fast drop the models expect is not instability", () => {
    const evening = Date.parse("2026-10-12T18:00:00Z"); // 20:00 Paris
    const t = buildTrend({
      hourly: hourly({ icon_seamless: diurnal(12, 15, 12), gfs_seamless: diurnal(12, 15, 12) }),
      metar: metar(
        [
          ["2026-10-12T17:20:00Z", 7],
          ["2026-10-12T17:50:00Z", 5],
        ],
        "METAR EDDM 121750Z AUTO VRB01KT CAVOK 05/03 Q1023",
      ),
      timezone: TZ,
      nowMs: evening,
    })!;
    expect(t.state).toBe("cooling");
    expect(t.reasons).toEqual([]);
    expect(t.horizon).toBe("22:00");
  });

  it("no peak ahead on a flat evening curve", () => {
    const t = buildTrend({
      hourly: hourly({ icon_seamless: (h) => (h >= 20 ? 10 + 0.01 * h : 12), gfs_seamless: (h) => (h >= 20 ? 10 : 12) }),
      metar: metar([
        ["2026-10-12T17:30:00Z", 10],
        ["2026-10-12T18:00:00Z", 10],
      ]),
      timezone: TZ,
      nowMs: Date.parse("2026-10-12T18:00:00Z"),
    })!;
    expect(t.peakAt).toBeNull();
    expect(t.peakPassed).toBe(true);
  });

  it("returns null without a METAR", () => {
    expect(
      buildTrend({
        hourly: hourly({ icon_seamless: diurnal(20) }),
        metar: { ok: false, fetchedAt: "", stale: false },
        timezone: TZ,
        nowMs: NOON,
      }),
    ).toBeNull();
  });
});
