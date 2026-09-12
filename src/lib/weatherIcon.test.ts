import { describe, expect, it } from "vitest";
import {
  iconFromMetar,
  iconFromPhrase,
  iconFromTwc,
  iconFromWmo,
  parseMetarSky,
} from "./weatherIcon";
import { rhFromTempDew } from "./metar";

describe("weather icons", () => {
  it("maps TWC / METAR / WMO tokens", () => {
    expect(iconFromTwc(32)).toBe("clear");
    expect(iconFromTwc(31)).toBe("night");
    expect(iconFromTwc(4)).toBe("thunder");
    expect(iconFromMetar("EGLC 121200Z 24005KT CAVOK 18/12 Q1017")).toBe("clear");
    expect(iconFromMetar("KHOU 121153Z 18008KT 10SM BKN044 28/22 A2990")).toBe(
      "cloudy",
    );
    expect(iconFromMetar("… TSRA …")).toBe("thunder");
    expect(iconFromWmo(0)).toBe("clear");
    expect(iconFromWmo(95)).toBe("thunder");
    expect(iconFromPhrase("Partly Cloudy")).toBe("partly");
  });

  it("summarises METAR sky", () => {
    expect(parseMetarSky("EGLC 121200Z CAVOK 18/12 Q1017")).toBe("CAVOK");
    expect(parseMetarSky("KHOU 121153Z 10SM FEW020 SCT040 BKN250 28/22")).toBe(
      "FEW020 SCT040 BKN250",
    );
  });
});

describe("rhFromTempDew", () => {
  it("returns nulls and a plausible humidity", () => {
    expect(rhFromTempDew(null, 10)).toBeNull();
    const rh = rhFromTempDew(20, 10);
    expect(rh).toBeGreaterThan(40);
    expect(rh).toBeLessThan(60);
  });
});
