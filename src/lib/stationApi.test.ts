import { describe, expect, it } from "vitest";
import {
  parseApiDay,
  publicStationPayload,
  toMarketDay,
} from "./stationApi";
import type { BiasResolution, ModelRow, StationPayload } from "./types";

function bias(source: BiasResolution["source"] = "season"): BiasResolution {
  return {
    season: "SON",
    source,
    unit: "C",
    biasNative: source === "none" ? null : 0.42,
    biasC: source === "none" ? 0 : 0.42,
    n: source === "none" ? 0 : 80,
    mae: source === "none" ? undefined : 1.1,
  };
}

function model(partial: Partial<ModelRow> & Pick<ModelRow, "id" | "role">): ModelRow {
  return {
    label: partial.id,
    rawMaxC: 22.1,
    rawMinC: 11.0,
    biasC: 0.42,
    bias: bias(),
    correctedMaxC: 21.68,
    deltaVsPrimaryC: 0,
    available: true,
    ...partial,
  };
}

function payload(): StationPayload {
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
      backups: ["icon_eu"],
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
          role: "primary",
          run: {
            initAt: "2026-09-16T09:00:00.000Z",
            initZ: "09Z",
            availableAt: "2026-09-16T10:26:00.000Z",
            dataset: "dwd_icon_d2",
            nest: "ICON-D2",
          },
        }),
        model({
          id: "icon_d2",
          role: "short-range",
          rawMaxC: 21.5,
          correctedMaxC: 21.1,
          deltaVsPrimaryC: -0.58,
        }),
        model({
          id: "meteofrance_seamless",
          role: "backup",
          bias: bias("none"),
          biasC: null,
          correctedMaxC: 22.1,
        }),
      ],
      requestedModels: ["icon_seamless", "icon_d2", "meteofrance_seamless"],
      hourly: [],
      primaryId: "icon_seamless",
      consensusCorrectedC: 21.4,
      consensusRawC: 21.8,
      consensusModelIds: ["icon_seamless"],
      spreadRawC: { min: 21.5, max: 22.1 },
      spreadCorrectedC: { min: 21.1, max: 21.68 },
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
      stationId: "EDDM",
      dailyMaxC: 21.0,
      predictedHighC: 21.0,
      lowC: 12.0,
      currentTempC: 18.3,
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
      forecastUrl: "https://www.wunderground.com/forecast/EDDM",
    },
    husky: {
      ok: true,
      dailyMaxC: 21.4,
      localDate: "2026-09-16",
      fetchedAt: "2026-09-16T09:00:00.000Z",
      stale: false,
      url: "https://huskyweather.com/station/EDDM",
    },
    polymarket: {
      ok: true,
      slug: "highest-temperature-in-munich-on-september-16-2026",
      unit: "C",
      step: 1,
      buckets: [],
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
  };
}

describe("parseApiDay", () => {
  it("defaults to now and aliases today", () => {
    expect(parseApiDay(null)).toBe("now");
    expect(parseApiDay("")).toBe("now");
    expect(parseApiDay("now")).toBe("now");
    expect(parseApiDay("today")).toBe("now");
    expect(parseApiDay("TODAY")).toBe("now");
  });

  it("accepts tomorrow", () => {
    expect(parseApiDay("tomorrow")).toBe("tomorrow");
    expect(toMarketDay("now")).toBe("today");
    expect(toMarketDay("tomorrow")).toBe("tomorrow");
  });

  it("rejects unknown values", () => {
    expect(parseApiDay("yesterday")).toBeNull();
    expect(parseApiDay("later")).toBeNull();
  });
});

describe("publicStationPayload", () => {
  it("exposes raw and bias-corrected models plus WU and Husky", () => {
    const json = publicStationPayload(payload(), {
      day: "now",
      dateRequested: "2026-09-16T09:43:00.000Z",
    });

    expect(json.icao).toBe("EDDM");
    expect(json.day).toBe("now");
    expect(json.market_date).toBe("2026-09-16");
    expect(json.date_requested).toBe("2026-09-16T09:43:00.000Z");
    expect(json.primary_model).toBe("icon_seamless");
    expect(json.primary_models).toEqual(["icon_seamless", "icon_eu"]);

    const primary = json.models.find((m) => m.id === "icon_seamless");
    expect(primary?.primary).toBe(true);
    expect(primary?.raw_max_c).toBe(22.1);
    expect(primary?.corrected_max_c).toBe(21.68);
    expect(primary?.bias_c).toBe(0.42);
    expect(primary?.run).toEqual({
      init_at: "2026-09-16T09:00:00.000Z",
      init_z: "09Z",
      available_at: "2026-09-16T10:26:00.000Z",
      nest: "ICON-D2",
    });

    const short = json.models.find((m) => m.id === "icon_d2");
    expect(short?.primary).toBe(false);
    expect(short?.role).toBe("short-range");

    const noBias = json.models.find((m) => m.id === "meteofrance_seamless");
    expect(noBias?.bias_c).toBeNull();
    expect(noBias?.bias.source).toBe("none");

    expect(json.wunderground.daily_max_c).toBe(21.0);
    expect(json.husky.daily_max_c).toBe(21.4);
    expect(json.consensus_corrected_c).toBe(21.4);
    expect(json.polymarket_slug).toBe(
      "highest-temperature-in-munich-on-september-16-2026",
    );
  });

  it("falls back to the constructed Polymarket slug when Gamma is empty", () => {
    const data = payload();
    data.polymarket.ok = false;
    data.polymarket.slug = "";

    const json = publicStationPayload(data, {
      day: "now",
      dateRequested: "2026-09-16T09:43:00.000Z",
    });

    expect(json.polymarket_slug).toBe(
      "highest-temperature-in-munich-on-september-16-2026",
    );
  });

  it("nulls WU/Husky highs when the upstream failed", () => {
    const data = payload();
    data.wu.ok = false;
    data.wu.error = "WU unavailable";
    data.husky.ok = false;
    data.husky.error = "Husky unavailable";

    const json = publicStationPayload(data, {
      day: "tomorrow",
      dateRequested: "2026-09-16T09:43:00.000Z",
    });

    expect(json.day).toBe("tomorrow");
    expect(json.wunderground.ok).toBe(false);
    expect(json.wunderground.daily_max_c).toBeNull();
    expect(json.wunderground.error).toBe("WU unavailable");
    expect(json.husky.ok).toBe(false);
    expect(json.husky.daily_max_c).toBeNull();
  });
});
