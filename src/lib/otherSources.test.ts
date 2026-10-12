import { describe, expect, it } from "vitest";
import { forMarketDay, parseImgwForecast, parseMeteoFranceForecast } from "./otherSources";

describe("meteofrance.com forecast", () => {
  const body = {
    properties: {
      forecast: [
        { time: "2026-10-12T18:00:00.000Z", T: 18.4 },
        { time: "2026-10-12T19:00:00.000Z", T: 17.9 },
        { time: "2026-10-12T22:00:00.000Z", T: null },
        { time: "2026-10-13T12:00:00.000Z", T: 22.1 },
      ],
      daily_forecast: [
        { time: "2026-10-12T00:00:00.000Z", T_max: 20.9 },
        { time: "2026-10-13T00:00:00.000Z", T_max: 22.5 },
      ],
    },
  };

  it("uses the site's daily max and keeps the market day's hours", () => {
    const raw = parseMeteoFranceForecast(body, "Le Bourget");
    expect(raw.dailyMaxC).toEqual({ "2026-10-12": 20.9, "2026-10-13": 22.5 });
    expect(forMarketDay(raw, "2026-10-12", "Europe/Paris")).toEqual({
      maxC: 20.9,
      maxScope: "day",
      hourly: [
        { at: "2026-10-12T18:00:00.000Z", tempC: 18.4 },
        { at: "2026-10-12T19:00:00.000Z", tempC: 17.9 },
      ],
    });
    expect(forMarketDay(raw, "2026-10-13", "Europe/Paris").maxC).toBe(22.5);
  });
});

describe("IMGW forecast", () => {
  const body = {
    data: {
      Valid: true,
      Data: [
        { Date: "2026-10-12T18:30:00Z", Temperature: "282.2" }, // nowcast, off the hourly grid
        { Date: "2026-10-12T19:00:00Z", Temperature: "282.0" },
        { Date: "2026-10-12T20:00:00Z", Temperature: "281.5" },
        { Date: "2026-10-12T21:00:00Z" }, // precipitation-only row
        ...Array.from({ length: 24 }, (_, h) => ({
          // 13 Oct, Warsaw local 00:00–23:00 = 12 Oct 22:00Z – 13 Oct 21:00Z
          Date: new Date(Date.UTC(2026, 9, 12, 22 + h)).toISOString().replace(".000Z", "Z"),
          Temperature: String(273.15 + 6 + (h === 13 ? 6.5 : h / 4)),
        })),
      ],
      Day_Night_Data: [
        { Date: "2026-10-13T00:00:00Z", isDay: false, Temp_Max: "281.6" },
        { Date: "2026-10-14T00:00:00Z", isDay: true, Temp_Max: "284.5" },
      ],
    },
  };

  it("converts kelvin, keeps the hourly grid, and scopes today's max to the hours left", () => {
    const raw = parseImgwForecast(body);
    expect(raw.dailyMaxC).toEqual({ "2026-10-14": 11.4 });
    const today = forMarketDay(raw, "2026-10-12", "Europe/Warsaw");
    expect(today.hourly).toEqual([
      { at: "2026-10-12T19:00:00.000Z", tempC: 8.9 },
      { at: "2026-10-12T20:00:00.000Z", tempC: 8.4 },
    ]);
    expect(today).toMatchObject({ maxC: 8.9, maxScope: "remaining" });
  });

  it("a full day of hours counts as the day's max", () => {
    const tomorrow = forMarketDay(parseImgwForecast(body), "2026-10-13", "Europe/Warsaw");
    expect(tomorrow.hourly).toHaveLength(24);
    expect(tomorrow).toMatchObject({ maxC: 12.5, maxScope: "day" });
  });

  it("rejects an invalid point", () => {
    expect(() => parseImgwForecast({ data: { Valid: false } })).toThrow(/not valid/);
  });
});
