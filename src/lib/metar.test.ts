import { describe, expect, it } from "vitest";
import { parseMetarTempToken, parseTGroup, runningMax, zonedDate } from "./metar";
import type { MetarLatest } from "./types";

const KSEA_1853 =
  "KSEA 111853Z 33008KT 10SM FEW040 SCT250 16/09 A3015 RMK AO2 SLP212 T01610094";

describe("METAR parsing", () => {
  it("reads tenths from the T-group, with sign", () => {
    expect(parseTGroup(KSEA_1853)).toBe(16.1);
    expect(parseTGroup("... RMK AO2 T10281050")).toBe(-2.8);
    expect(parseTGroup("EGLC 112320Z 24004KT 9999 FEW030 18/12 Q1017")).toBeNull();
  });

  it("reads the integer body token, with M for negatives", () => {
    expect(parseMetarTempToken(KSEA_1853)).toBe(16);
    expect(parseMetarTempToken("EGLC 112320Z 24004KT 9999 FEW030 18/12 Q1017")).toBe(18);
    expect(parseMetarTempToken("EFHK 120050Z 00000KT M03/M05 Q1020")).toBe(-3);
    expect(parseMetarTempToken("XXXX 120050Z 00000KT 07/// Q1020")).toBe(7);
    expect(parseMetarTempToken("no temp here")).toBeNull();
  });
});

describe("runningMax", () => {
  function obs(iso: string, tempC: number, tempBodyC: number | null): MetarLatest {
    return { tempC, tempBodyC, dewpointC: null, observedAt: iso, raw: "" };
  }

  it("splits physical (tenths) and resolution (integer body) maxima by local day", () => {
    const observations = [
      obs("2026-09-11T23:53:00Z", 18.9, 19), // 16:53 Seattle, 11 Sep
      obs("2026-09-11T20:53:00Z", 18.3, 18),
      obs("2026-09-11T06:53:00Z", 14.0, 14), // 23:53 Seattle, 10 Sep → other day
      obs("2026-09-12T01:53:00Z", 17.2, 17), // 18:53 Seattle, 11 Sep
    ];
    const r = runningMax(observations, "America/Los_Angeles", "2026-09-11");
    expect(r.runningMaxC).toBe(18.9);
    expect(r.runningMaxAt).toBe("2026-09-11T23:53:00Z");
    expect(r.resolutionMaxC).toBe(19);
  });

  it("body integer can exceed the tenths max after rounding", () => {
    // 18.5 tenths reports as 19 in the body (ASOS rounds half up).
    const observations = [obs("2026-09-11T21:53:00Z", 18.5, 19)];
    const r = runningMax(observations, "America/Los_Angeles", "2026-09-11");
    expect(r.runningMaxC).toBe(18.5);
    expect(r.resolutionMaxC).toBe(19);
  });

  it("returns nulls when no observation falls on the market day", () => {
    const r = runningMax(
      [obs("2026-09-11T06:53:00Z", 14.0, 14)],
      "America/Los_Angeles",
      "2026-09-11",
    );
    expect(r.runningMaxC).toBeNull();
    expect(r.resolutionMaxC).toBeNull();
  });
});

describe("zonedDate", () => {
  it("converts an instant to the station's local calendar date", () => {
    expect(zonedDate("2026-09-11T23:30:00Z", "Europe/Amsterdam")).toBe("2026-09-12");
    expect(zonedDate("2026-09-11T23:30:00Z", "America/Los_Angeles")).toBe("2026-09-11");
  });
});
