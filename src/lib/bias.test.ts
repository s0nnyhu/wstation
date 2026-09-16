import { describe, expect, it } from "vitest";
import { getBias, MIN_BIAS_N, seasonFromDate } from "./bias";

describe("seasonFromDate", () => {
  it("maps months to DJF/MAM/JJA/SON", () => {
    expect(seasonFromDate("2026-12-15")).toBe("DJF");
    expect(seasonFromDate("2026-01-01")).toBe("DJF");
    expect(seasonFromDate("2026-02-28")).toBe("DJF");
    expect(seasonFromDate("2026-03-01")).toBe("MAM");
    expect(seasonFromDate("2026-05-31")).toBe("MAM");
    expect(seasonFromDate("2026-06-01")).toBe("JJA");
    expect(seasonFromDate("2026-08-31")).toBe("JJA");
    expect(seasonFromDate("2026-09-12")).toBe("SON");
    expect(seasonFromDate("2026-11-30")).toBe("SON");
  });
});

describe("getBias against data/biases.seasonal.json", () => {
  it("uses the seasonal stat when n >= MIN_BIAS_N", () => {
    const r = getBias({ icao: "EHAM", model: "icon_seamless", dateLocal: "2026-09-12" });
    expect(r.season).toBe("SON");
    expect(r.source).toBe("season");
    expect(r.unit).toBe("C");
    expect(r.n).toBeGreaterThanOrEqual(MIN_BIAS_N);
    expect(r.biasC).toBe(r.biasNative);
    expect(r.mae).toBeGreaterThan(0);
  });

  it("converts American biases from °F to °C", () => {
    const r = getBias({ icao: "KLGA", model: "gfs_seamless", dateLocal: "2026-07-04" });
    expect(r.unit).toBe("F");
    expect(r.source).toBe("season");
    expect(r.biasC).toBeCloseTo(((r.biasNative as number) * 5) / 9, 10);
  });

  it("uses the monthly stat when grain=month and n is sufficient", () => {
    const r = getBias({
      icao: "EHAM",
      model: "icon_seamless",
      dateLocal: "2026-07-04",
      grain: "month",
    });
    expect(r.source).toBe("month");
    expect(r.month).toBe("07");
  });

  it("honours a forced season", () => {
    const auto = getBias({ icao: "EHAM", model: "knmi_seamless", dateLocal: "2026-01-15" });
    const forced = getBias({
      icao: "EHAM",
      model: "knmi_seamless",
      dateLocal: "2026-01-15",
      seasonMode: "JJA",
    });
    expect(auto.season).toBe("DJF");
    expect(forced.season).toBe("JJA");
    expect(forced.biasNative).not.toBe(auto.biasNative);
  });

  it("returns source none with a zero bias for unknown models", () => {
    const r = getBias({ icao: "EHAM", model: "does_not_exist", dateLocal: "2026-09-12" });
    expect(r.source).toBe("none");
    expect(r.biasC).toBe(0);
    expect(r.biasNative).toBeNull();
    expect(r.n).toBe(0);
  });

  it("returns source none for unknown stations", () => {
    const r = getBias({ icao: "ZZZZ", model: "icon_seamless", dateLocal: "2026-09-12" });
    expect(r.source).toBe("none");
  });

  it("loads WRH seasonal bias for ZSPD UKMO and ZGSZ AIFS", () => {
    const shanghai = getBias({
      icao: "ZSPD",
      model: "ukmo_seamless",
      dateLocal: "2026-09-12",
    });
    expect(shanghai.unit).toBe("C");
    expect(shanghai.source).toBe("season");
    expect(shanghai.season).toBe("SON");
    expect(shanghai.n).toBeGreaterThanOrEqual(MIN_BIAS_N);
    expect(shanghai.biasC).toBeLessThan(0);

    const shenzhen = getBias({
      icao: "ZGSZ",
      model: "ecmwf_aifs025_single",
      dateLocal: "2026-09-12",
    });
    expect(shenzhen.source).toBe("season");
    expect(shenzhen.n).toBeGreaterThanOrEqual(MIN_BIAS_N);
    expect(shenzhen.biasC).toBeLessThan(0);
  });

  it("flags HRRR as identical to GFS seamless in this archive", () => {
    const r = getBias({ icao: "KHOU", model: "gfs_hrrr", dateLocal: "2026-09-12" });
    expect(r.identicalToSeamless).toBe(true);
  });
});
