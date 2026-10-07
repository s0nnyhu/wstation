import { describe, expect, it } from "vitest";
import {
  bucketProbabilitiesFromLive,
  isLiveBiasStation,
  leadFor,
  LIVE_BIAS_MAX_AGE_MS,
  liveBiasFor,
  liveForecastFor,
  parseLiveBias,
} from "./liveBias";

const NOW = Date.parse("2026-10-07T12:00:00Z");

const file = {
  version: 1,
  generated_utc: "2026-10-07T11:00:00Z",
  methods: { J0_08h: "expanding", J1: "roll30" },
  stations: {
    EDDM: {
      updated_utc: "2026-10-07T11:00:00Z",
      local_time: "2026-10-07 13:00",
      slot: "J0_10h30",
      corrections: {
        "2026-10-07": {
          J0_08h: { icon_d2: { bias: -0.75, n: 180 }, ecmwf_ifs025: { bias: -1.68, n: 180 } },
          J0_10h30: { icon_d2: { bias: -0.7, n: 180 } },
        },
        "2026-10-08": {
          J1: { icon_eu: { bias: -0.6, n: 30 }, ukmo_global_deterministic_10km: { bias: -1.2, n: 30 } },
        },
      },
      forecast: {
        "2026-10-08": {
          lead: "J1",
          status: "ok",
          blend: 20.6,
          mu: 20.8,
          sd: 1.07,
          probs: { "19": 0.1, "20": 0.3, "21": 0.4, "22": 0.2 },
          k_top: 21,
          p_top: 0.4,
        },
      },
    },
  },
};

describe("leadFor", () => {
  it("maps the local consultation time to the lead", () => {
    expect(leadFor("today", "2026-10-07T07:59:00")).toBe("J0_08h");
    expect(leadFor("today", "2026-10-07T10:29:59")).toBe("J0_08h");
    expect(leadFor("today", "2026-10-07T10:30:00")).toBe("J0_10h30");
    expect(leadFor("today", "2026-10-07T13:30:00")).toBe("J0_13h30");
    expect(leadFor("today", "2026-10-07T22:00:00")).toBe("J0_13h30");
    expect(leadFor("tomorrow", "2026-10-07T09:00:00")).toBe("J1");
  });
});

describe("parseLiveBias", () => {
  it("accepts a recent file", () => {
    const r = parseLiveBias(file, NOW);
    expect(r.ok).toBe(true);
    expect(r.generatedUtc).toBe(file.generated_utc);
  });

  it("rejects a stale or malformed file", () => {
    expect(parseLiveBias(file, NOW + LIVE_BIAS_MAX_AGE_MS + 1).ok).toBe(false);
    expect(parseLiveBias({ foo: 1 }, NOW).ok).toBe(false);
    expect(parseLiveBias(null, NOW).ok).toBe(false);
  });
});

describe("liveBiasFor", () => {
  const live = parseLiveBias(file, NOW);

  it("uses the native short-range run for a seamless model", () => {
    const r = liveBiasFor(live, "EDDM", "2026-10-07", "J0_08h", "icon_seamless");
    expect(r).toMatchObject({ biasC: -0.75, n: 180, nativeModel: "icon_d2", method: "expanding" });
  });

  it("falls back along the seamless chain when the short-range run is absent", () => {
    expect(liveBiasFor(live, "EDDM", "2026-10-08", "J1", "icon_seamless")?.nativeModel).toBe("icon_eu");
    expect(liveBiasFor(live, "EDDM", "2026-10-08", "J1", "ukmo_seamless")?.nativeModel).toBe(
      "ukmo_global_deterministic_10km",
    );
  });

  it("returns null when there is nothing to apply", () => {
    expect(liveBiasFor(live, "EDDM", "2026-10-07", "J0_13h30", "icon_seamless")).toBeNull();
    expect(liveBiasFor(live, "EDDM", "2026-10-07", "J0_08h", "meteofrance_arome_france")).toBeNull();
    expect(liveBiasFor(live, "LFPB", "2026-10-07", "J0_08h", "icon_seamless")).toBeNull();
    expect(liveBiasFor(parseLiveBias(file, NOW + LIVE_BIAS_MAX_AGE_MS + 1), "EDDM", "2026-10-07", "J0_08h", "icon_d2")).toBeNull();
  });
});

describe("liveForecastFor / bucketProbabilitiesFromLive", () => {
  const live = parseLiveBias(file, NOW);

  it("returns the forecast of the market day only", () => {
    expect(liveForecastFor(live, "EDDM", "2026-10-08")?.k_top).toBe(21);
    expect(liveForecastFor(live, "EDDM", "2026-10-07")).toBeNull();
  });

  it("sums integer probabilities into buckets, tails included", () => {
    const probs = liveForecastFor(live, "EDDM", "2026-10-08")!.probs!;
    const p = bucketProbabilitiesFromLive(
      [
        { lo: null, hi: 19 },
        { lo: 20, hi: 20 },
        { lo: 21, hi: 21 },
        { lo: 22, hi: null },
      ],
      probs,
    );
    expect(p.map((x) => Number(x.toFixed(3)))).toEqual([0.1, 0.3, 0.4, 0.2]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("isLiveBiasStation", () => {
  it("is limited to the four analysed stations", () => {
    expect(isLiveBiasStation("eddm")).toBe(true);
    expect(isLiveBiasStation("EGLC")).toBe(true);
    expect(isLiveBiasStation("LIMC")).toBe(false);
  });
});
