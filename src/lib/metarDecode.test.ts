import { describe, expect, it } from "vitest";
import { decodeWeatherToken, describeMetar, metarBodyTokens, solarElevationDeg } from "./metarDecode";
import type { MetarLatest } from "./types";

function metar(raw: string, fields: Partial<MetarLatest>): MetarLatest {
  return { tempC: 15, tempBodyC: 15, dewpointC: null, observedAt: "2026-10-12T12:00:00Z", raw, ...fields };
}

const PARIS = { lat: 48.9694, lon: 2.4414, unit: "C" as const };
const SINGAPORE = { lat: 1.3592, lon: 103.9894, unit: "C" as const };

describe("present weather groups", () => {
  it("decodes intensity, descriptors and proximity", () => {
    expect(decodeWeatherToken("-SHRA")).toBe("Light rain showers");
    expect(decodeWeatherToken("+TSRA")).toBe("Thunderstorm with heavy rain");
    expect(decodeWeatherToken("-TSRA")).toBe("Thunderstorm with light rain");
    expect(decodeWeatherToken("TS")).toBe("Thunderstorm");
    expect(decodeWeatherToken("VCSH")).toBe("Showers nearby");
    expect(decodeWeatherToken("VCTS")).toBe("Thunderstorm nearby");
    expect(decodeWeatherToken("FZFG")).toBe("Freezing fog");
    expect(decodeWeatherToken("BCFG")).toBe("Patches of fog");
    expect(decodeWeatherToken("-RASN")).toBe("Light rain and snow");
    expect(decodeWeatherToken("RESHRA")).toBe("Recent rain showers");
    expect(decodeWeatherToken("HZ")).toBe("Haze");
  });

  it("ignores non-weather tokens", () => {
    for (const t of ["AUTO", "CAVOK", "NSW", "Q1019", "9999", "BKN036", "18012KT", "RE"]) {
      expect(decodeWeatherToken(t)).toBeNull();
    }
  });

  it("drops trend groups and remarks", () => {
    expect(metarBodyTokens("METAR LFPB 121730Z 15/09 Q1015 TEMPO 4000 SHRA")).toEqual([
      "LFPB",
      "121730Z",
      "15/09",
      "Q1015",
    ]);
  });
});

describe("solar elevation", () => {
  it("tells day from night", () => {
    expect(solarElevationDeg(48.97, 2.44, new Date("2026-10-12T12:00:00Z"))).toBeGreaterThan(25);
    expect(solarElevationDeg(48.97, 2.44, new Date("2026-10-12T22:00:00Z"))).toBeLessThan(-20);
  });
});

describe("describeMetar", () => {
  it("overcast evening at Le Bourget", () => {
    const m = metar(
      "METAR LFPB 121730Z AUTO 18012KT 150V210 9999 BKN036 BKN044 OVC052 20/10 Q1019 NOSIG",
      { tempC: 20, windDirDeg: 180, windSpeedKt: 12, observedAt: "2026-10-12T17:30:00Z" },
    );
    expect(describeMetar(m, PARIS)).toEqual({
      icon: "cloudy",
      parts: ["Overcast", "Moderate wind from S 22 km/h"],
    });
  });

  it("sunny day, clear night", () => {
    const raw = "METAR LFPB 121200Z AUTO 19012KT CAVOK 20/08 Q1018";
    const day = describeMetar(metar(raw, { windDirDeg: 190, windSpeedKt: 2 }), PARIS);
    expect(day).toEqual({ icon: "clear", parts: ["Sunny", "Calm"] });
    const night = describeMetar(
      metar(raw, { windSpeedKt: 2, observedAt: "2026-10-12T22:00:00Z" }),
      PARIS,
    );
    expect(night).toEqual({ icon: "night", parts: ["Clear sky", "Calm"] });
  });

  it("tropical showers with haze and low visibility", () => {
    const m = metar(
      "METAR WSSS 120400Z 10007KT 030V140 2500 -SHRA HZ FEW012 FEW016CB SCT017TCU 30/25 Q1012 NOSIG",
      { tempC: 30, dewpointC: 25, humidityPct: 75, windDirDeg: 100, windSpeedKt: 7, observedAt: "2026-10-12T04:00:00Z" },
    );
    const { icon, parts } = describeMetar(m, SINGAPORE);
    expect(icon).toBe("rain");
    expect(parts.slice(0, 5)).toEqual([
      "Partly cloudy, cumulonimbus and towering cumulus around",
      "Light rain showers",
      "Haze",
      "Poor visibility 2.5 km",
      "Light wind from E 13 km/h",
    ]);
    expect(parts[5]).toMatch(/^Humid, feels like 3\d°C$/);
  });

  it("cold gusty snow with wind chill, and mph in °F", () => {
    const m = metar("METAR EFHK 120050Z 33018G28KT 9999 -SN BKN010 M03/M05 Q1020", {
      tempC: -3,
      windDirDeg: 330,
      windSpeedKt: 18,
      windGustKt: 28,
      observedAt: "2026-10-12T00:50:00Z",
    });
    const efhk = { lat: 60.317, lon: 24.963 };
    expect(describeMetar(m, { ...efhk, unit: "C" }).parts).toEqual([
      "Mostly cloudy",
      "Light snow",
      "Fresh wind from NW 33 km/h, gusts 52 km/h",
      "Cold wind, feels like -11°C",
    ]);
    expect(describeMetar(m, { ...efhk, unit: "F" }).parts[2]).toBe(
      "Fresh wind from NW 21 mph, gusts 32 mph",
    );
  });

  it("variable wind", () => {
    const m = metar("METAR KSEA 121653Z VRB03KT 10SM FEW080 09/04 A3007", { tempC: 9, windDirDeg: null, windSpeedKt: 3 });
    expect(describeMetar(m, { lat: 47.45, lon: -122.31, unit: "F" }).parts).toContain("Light variable wind 3 mph");
  });

  it("US statute-mile visibility", () => {
    const m = metar("METAR KSEA 121853Z 00000KT 1 1/2SM BR OVC004 12/12 A3015", { windSpeedKt: 0 });
    expect(describeMetar(m, { lat: 47.45, lon: -122.31, unit: "F" }).parts).toEqual([
      "Overcast",
      "Mist",
      "Poor visibility 1.5 mi",
      "Calm",
    ]);
  });
});
