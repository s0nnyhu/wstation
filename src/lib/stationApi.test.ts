import { describe, expect, it } from "vitest";
import {
  parseApiDay,
  publicStationPayload,
  toMarketDay,
} from "./stationApi";
import { ensemblePayload as payload } from "./testFixtures";

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
  it("exposes raw and corrected ensemble models, the blend and the distribution", () => {
    const json = publicStationPayload(payload(), {
      day: "now",
      dateRequested: "2026-09-16T09:43:00.000Z",
    });

    expect(json.icao).toBe("EDDM");
    expect(json.day).toBe("now");
    expect(json.market_date).toBe("2026-09-16");
    expect(json.date_requested).toBe("2026-09-16T09:43:00.000Z");
    expect(json.primary_model).toBe("icon_d2");
    expect(json.primary_models).toEqual(["icon_d2"]);

    const d2 = json.models.find((m) => m.id === "icon_d2");
    expect(d2?.role).toBe("blend");
    expect(d2?.raw_max_c).toBe(25.3);
    expect(d2?.corrected_max_c).toBe(25.9);
    expect(d2?.bias_c).toBe(-0.6);
    expect(d2?.bias_n).toBe(180);
    expect(d2?.status).toBe("selected");
    expect(d2?.weight).toBe(0.5);
    expect(d2?.run).toEqual({
      init_at: "2026-09-16T06:00:00.000Z",
      init_z: "06Z",
      available_at: "2026-09-16T07:26:00.000Z",
      nest: null,
    });

    const out = json.models.find((m) => m.id === "icon_global");
    expect(out?.status).toBe("redundant");
    expect(out?.weight).toBeNull();

    expect(json.consensus_corrected_c).toBe(25.4);
    expect(json.consensus_raw_c).toBe(25.2);
    expect(json.ensemble).toMatchObject({
      ok: true,
      lead: "J0_10h30",
      blend_c: 25.4,
      most_likely_c: 26,
      most_likely_p: 0.41,
      range80_c: { lo: 25, hi: 27 },
      truncated_at_c: 24,
    });
    expect(json.ensemble?.probs?.length).toBe(4);

    expect(json.wunderground.daily_max_c).toBe(26);
    expect(json.husky.daily_max_c).toBe(25);
    expect(json.metar.running_max_c).toBe(25.0);
    expect(json.metar.resolution_max_c).toBe(24);
    expect(json.synoptic.ok).toBe(false);
    expect(json.polymarket_slug).toBe(
      "highest-temperature-in-munich-on-september-16-2026",
    );
    expect(json.polymarket_url).toBe(
      "https://polymarket.com/event/highest-temperature-in-munich-on-september-16-2026",
    );
  });

  it("has no correction, blend or distribution for a raw-only station", () => {
    const data = payload();
    data.station.ensemble = false;
    data.forecast.ensemble = null;
    data.forecast.consensusCorrectedC = null;
    data.forecast.models = data.forecast.models.map((m) => ({
      ...m,
      role: "primary" as const,
      correctionC: null,
      correctionN: null,
      correctedMaxC: null,
      status: undefined,
      weight: undefined,
    }));
    const json = publicStationPayload(data, { day: "now", dateRequested: "2026-09-16T09:43:00.000Z" });
    expect(json.ensemble).toBeNull();
    expect(json.consensus_corrected_c).toBeNull();
    expect(json.models[0].bias_c).toBeNull();
    expect(json.models[0].corrected_max_c).toBeNull();
    expect(json.models[0].primary).toBe(true);
    expect(json.models[0]).not.toHaveProperty("status");
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
    expect(json.polymarket_url).toBe(
      "https://polymarket.com/event/highest-temperature-in-munich-on-september-16-2026",
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
