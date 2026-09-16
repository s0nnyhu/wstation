import { describe, expect, it } from "vitest";
import { formatStationClipboard, pickPolymarketFavorite } from "./copySnapshot";
import type {
  BiasResolution,
  ModelRow,
  PolymarketBucket,
  StationPayload,
} from "./types";

function bias(): BiasResolution {
  return {
    season: "SON",
    source: "season",
    unit: "C",
    biasNative: 0.4,
    biasC: 0.4,
    n: 80,
  };
}

function model(partial: Partial<ModelRow> & Pick<ModelRow, "id" | "role">): ModelRow {
  return {
    label: partial.id,
    rawMaxC: 22,
    rawMinC: 11,
    biasC: 0.4,
    bias: bias(),
    correctedMaxC: 21.6,
    deltaVsPrimaryC: 0,
    available: true,
    ...partial,
  };
}

function bucket(
  label: string,
  yesPrice: number | null,
  lo: number,
  hi: number,
): PolymarketBucket {
  return {
    label,
    lo,
    hi,
    unit: "C",
    yesPrice,
    bestBid: yesPrice,
    bestAsk: yesPrice,
  };
}

function payload(overrides: Partial<StationPayload> = {}): StationPayload {
  return {
    station: {
      icao: "EDDM",
      city: "Munich",
      name: "Munich",
      region: "europe",
      lat: 48.35,
      lon: 11.78,
      timezone: "Europe/Berlin",
      defaultUnit: "C",
      primary: "icon_seamless",
      primaryModels: ["icon_seamless", "icon_eu"],
      shortRange: "icon_d2",
      h6Model: "icon_d2",
      backups: ["meteofrance_seamless"],
      notes: [],
      warnings: [],
    },
    day: "today",
    marketDate: "2026-09-16",
    localNow: "2026-09-16T11:00:00",
    forecast: {
      models: [
        model({
          id: "icon_seamless",
          label: "ICON Seamless",
          role: "primary",
          correctedMaxC: 26.0,
        }),
        model({
          id: "icon_eu",
          label: "ICON-EU",
          role: "primary",
          correctedMaxC: 24.7,
        }),
        model({
          id: "icon_d2",
          label: "ICON-D2",
          role: "short-range",
          correctedMaxC: 27.0,
        }),
        model({
          id: "meteofrance_seamless",
          label: "Météo-France Seamless",
          role: "backup",
          correctedMaxC: 25.9,
        }),
      ],
      requestedModels: [],
      hourly: [],
      primaryId: "icon_seamless",
      consensusCorrectedC: 25.4,
      consensusRawC: 25.8,
      consensusModelIds: ["icon_seamless"],
      spreadRawC: null,
      spreadCorrectedC: null,
      spreadCorrectedCount: 2,
      peak: null,
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
      season: "SON",
      seasonMode: "auto",
      biasGrain: "season",
    },
    metar: { ok: true, fetchedAt: "2026-09-16T09:00:00.000Z", stale: false },
    wu: {
      ok: true,
      dailyMaxC: 26,
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
    },
    husky: {
      ok: true,
      dailyMaxC: 25,
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
      url: "https://huskyweather.com/station/EDDM",
    },
    polymarket: {
      ok: true,
      slug: "highest-temperature-in-munich-on-september-16-2026",
      unit: "C",
      step: 1,
      buckets: [
        bucket("25°C", 0.12, 25, 25),
        bucket("26°C", 0.41, 26, 26),
        bucket("27°C", 0.18, 27, 27),
      ],
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
    },
    synoptic: {
      ok: false,
      configured: false,
      resolutionMax: null,
      resolutionMaxAt: null,
      maxC: null,
      latestC: null,
      latestAt: null,
      observationCount: 0,
      unit: "C",
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
    },
    drivers: {
      modelId: "icon_seamless",
      windowLabel: "",
      aroundPeak: {
        avgCloudCover: null,
        maxPrecipProb: null,
        sumPrecipMm: null,
        avgWindSpeedMps: null,
        maxGustMps: null,
        avgShortwaveWm2: null,
        dominantWeatherCode: null,
      },
      now: {
        cloudCover: null,
        precipProb: null,
        precipMm: null,
        windSpeedMps: null,
        shortwaveWm2: null,
        humidityPct: null,
        metarWindKt: null,
        metarWindDirDeg: null,
        metarGustKt: null,
      },
      flags: [],
    },
    biasMeta: {
      source: "test",
      sample: "test",
      asOf: "2026-09-01",
      definition: "test",
    },
    backtest: [],
    compareAll: false,
    seasonMode: "auto",
    biasGrain: "season",
    ...overrides,
  };
}

describe("pickPolymarketFavorite", () => {
  it("picks the highest yes price", () => {
    const fav = pickPolymarketFavorite(payload().polymarket.buckets);
    expect(fav?.label).toBe("26°C");
  });

  it("returns null when nothing is priced", () => {
    expect(pickPolymarketFavorite([bucket("26°C", null, 26, 26)])).toBeNull();
  });
});

describe("formatStationClipboard", () => {
  it("formats a compact snapshot in the display unit", () => {
    const text = formatStationClipboard(
      payload(),
      "C",
      new Date("2026-09-16T09:58:12.000Z"),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("Munich (EDDM)");
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(lines[2]).toBe("WU 26.0°C");
    expect(lines[3]).toBe("Husky 25.0°C");
    expect(lines[4]).toBe("ICON Seamless (primary) 26.0°C");
    expect(lines[5]).toBe("ICON-EU (primary) 24.7°C");
    expect(lines[6]).toBe("Météo-France Seamless (backup) 25.9°C");
    expect(lines[7]).toBe("H-6 27°C (26°C · 27°C)");
    expect(lines[8]).toBe("Favorite 26°C (41¢)");
    expect(text).not.toContain("ICON-D2");
  });

  it("uses em dashes when WU, Husky or the market are missing", () => {
    const data = payload();
    data.wu.ok = false;
    data.husky.ok = false;
    data.polymarket.ok = false;
    const text = formatStationClipboard(
      data,
      "C",
      new Date("2026-09-16T09:58:12.000Z"),
    );
    expect(text).toContain("WU —");
    expect(text).toContain("Husky —");
    expect(text).toContain("Favorite —");
  });
});
