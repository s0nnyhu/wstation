import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/biais.sample.json";
import {
  applyRecipe,
  bucketProbabilities,
  effectiveInitUnix,
  findRecipe,
  leadFor,
  localDayHoursUtc,
  parseRecipeFile,
  rawTmax,
  RECIPE_MAX_AGE_MS,
  type Lead,
  windowStartUnix,
  type Recipe,
  type RecipeFile,
} from "./ensemble";

interface SampleForecast {
  lead: Lead;
  status: string;
  blend: number;
  mu: number;
  sd: number;
  probs: Record<string, number>;
  k_top: number;
  p_top: number;
  m_obs?: number | null;
  raw: Record<string, number | null>;
}

const file = sample as unknown as RecipeFile & {
  stations: Record<string, { forecast: Record<string, SampleForecast> }>;
};
const NOW = Date.parse(file.generated_utc) + 60_000;

describe("parity with the weather-analysis pipeline (real biais.json extract)", () => {
  const cases = Object.entries(file.stations).flatMap(([st, s]) =>
    Object.entries(s.forecast).map(([date, f]) => ({ st, date, f })),
  );

  it.each(cases)("$st $date: same blend, distribution and probabilities", ({ st, date, f }) => {
    const recipe = file.stations[st].recipes![date][f.lead] as Recipe;
    const r = applyRecipe(recipe, f.raw, file.discretization, f.m_obs ?? null);
    expect(r).not.toBeNull();
    expect(r!.blendC).toBeCloseTo(f.blend, 2);
    expect(r!.mu!).toBeCloseTo(f.mu, 2);
    expect(r!.sd!).toBeCloseTo(f.sd, 2);
    expect(r!.kTop).toBe(f.k_top);
    for (const [k, p] of Object.entries(f.probs)) {
      const mine = r!.probs.find((x) => x.k === Number(k))?.p ?? 0;
      expect(Math.abs(mine - p)).toBeLessThan(0.002);
    }
    expect(r!.probs.reduce((s, x) => s + x.p, 0)).toBeGreaterThan(0.99);
  });
});

describe("applyRecipe", () => {
  const recipe: Recipe = {
    correction_method: "roll30",
    blend: { method: "mean", size: "top3" },
    models: {
      a: { bias: -1, n: 30, mse_exp: 1.0, mse_r30: 1.0 },
      b: { bias: 0.5, n: 30, mse_exp: 2.0, mse_r30: 2.0 },
      a_twin: { bias: -1.1, n: 30, mse_exp: 1.5, mse_r30: 1.5 },
      c: { bias: 0, n: 30, mse_exp: 3.0, mse_r30: 3.0 },
      d: { bias: 0, n: 30, mse_exp: 4.0, mse_r30: 4.0 },
      young: { bias: 0, n: 5, mse_exp: null, mse_r30: null },
    },
    family_drop: [{ a: "a", b: "a_twin", drop: "a_twin" }],
    distribution: { kind: "ngr_nospread", a: 0, b: 1, c: 1, d: 0, fit: "station", n: 100 },
    metar_constraint: "troncature",
  };
  const disc = { round_var: 1 / 12, min_var: 0.05, floor: 0.005, window: 6 };
  const raws = { a: 20, b: 21, a_twin: 20, c: 22, d: 30, young: 25 };

  it("corrects, de-duplicates families and keeps the top-k by past error", () => {
    const r = applyRecipe(recipe, raws, disc, null)!;
    expect(r.selected).toEqual(["a", "b", "c"]);
    expect(r.blendC).toBeCloseTo((21 + 20.5 + 22) / 3, 6);
    expect(r.rows.find((x) => x.model === "a_twin")?.status).toBe("redundant");
    expect(r.rows.find((x) => x.model === "d")?.status).toBe("eligible");
    expect(r.rows.find((x) => x.model === "young")?.status).toBe("no-skill-yet");
    expect(r.rows.find((x) => x.model === "a")?.weight).toBeCloseTo(1 / 3, 6);
  });

  it("keeps a same-family model when its twin has no forecast", () => {
    const r = applyRecipe(recipe, { ...raws, a: null }, disc, null)!;
    expect(r.selected[0]).toBe("a_twin");
    expect(r.rows.find((x) => x.model === "a")?.status).toBe("missing");
  });

  it("excludes outcomes below the METAR high and renormalises", () => {
    const r = applyRecipe(recipe, raws, disc, 23)!;
    expect(r.truncatedAt).toBe(23);
    expect(r.probs.every((x) => x.k >= 23)).toBe(true);
    expect(r.probs.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 6);
    expect(r.kTop).toBe(23);
  });

  it("weights by inverse past MSE", () => {
    const r = applyRecipe({ ...recipe, blend: { method: "invmse_exp", size: "all" } }, raws, disc, null)!;
    const w = [1, 1 / 2, 1 / 3, 1 / 4];
    const v = [21, 20.5, 22, 30];
    expect(r.blendC).toBeCloseTo(v.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((s, x) => s + x, 0), 6);
  });

  it("returns null when no model can be used", () => {
    expect(applyRecipe(recipe, {}, disc, null)).toBeNull();
  });
});

describe("raw Tmax (pipeline rule)", () => {
  it("has 23 / 24 / 25 local hours around the DST changes", () => {
    expect(localDayHoursUtc("2026-03-29", "Europe/Berlin")).toHaveLength(23);
    expect(localDayHoursUtc("2026-10-07", "Europe/Berlin")).toHaveLength(24);
    expect(localDayHoursUtc("2026-10-25", "Europe/London")).toHaveLength(25);
    expect(localDayHoursUtc("2026-10-07", "Europe/London")[0]).toBe(Date.parse("2026-10-06T23:00:00Z") / 1000);
  });

  it("uses only the hours at or after the run initialisation, all of them present", () => {
    const hours = localDayHoursUtc("2026-10-07", "Europe/Paris");
    const temps = hours.map((_, i) => 10 + i * 0.1);
    temps[1] = 99; // 01:00 local = 23Z the day before: before a 00Z init
    const init00z = Date.parse("2026-10-07T00:00:00Z") / 1000;
    expect(rawTmax(hours, temps, "2026-10-07", "Europe/Paris", init00z)).toBeCloseTo(10 + 23 * 0.1, 6);
    const holed: Array<number | null> = [...temps];
    holed[20] = null;
    expect(rawTmax(hours, holed, "2026-10-07", "Europe/Paris", init00z)).toBeNull();
  });

  it("estimates the run from the publication delay when meta.json is stale", () => {
    const now = Date.parse("2026-10-07T09:00:00Z");
    expect(effectiveInitUnix("2026-10-07T06:00:00.000Z", 1.75, now)).toBe(Date.parse("2026-10-07T06:00:00Z") / 1000);
    expect(effectiveInitUnix("2026-05-26T00:00:00.000Z", 5.5, now)).toBe(Date.parse("2026-10-07T00:00:00Z") / 1000);
    expect(effectiveInitUnix(null, 10, now)).toBe(Date.parse("2026-10-06T12:00:00Z") / 1000);
  });
});

describe("windowStartUnix", () => {
  it("keeps today's window covering the afternoon even when the newest run starts after the peak", () => {
    const init18z = Date.parse("2026-10-07T18:00:00Z") / 1000;
    // J0_13h30 in Berlin = 11:30Z; with a 1.75 h delay the latest 00Z/12Z run then is 00Z.
    expect(windowStartUnix("J0_13h30", "2026-10-07", "Europe/Berlin", init18z, 1.75)).toBe(
      Date.parse("2026-10-07T00:00:00Z") / 1000,
    );
    const init06z = Date.parse("2026-10-07T06:00:00Z") / 1000;
    expect(windowStartUnix("J1", "2026-10-08", "Europe/Berlin", init06z, 1.75)).toBe(init06z);
  });
});

describe("lead and recipe lookup", () => {
  it("maps the local consultation time to the lead", () => {
    expect(leadFor("today", "2026-10-07T07:59:00")).toBe("J0_08h");
    expect(leadFor("today", "2026-10-07T10:30:00")).toBe("J0_10h30");
    expect(leadFor("today", "2026-10-07T13:30:00")).toBe("J0_13h30");
    expect(leadFor("tomorrow", "2026-10-07T23:00:00")).toBe("J1");
  });

  it("falls back to the latest earlier recipe for the same lead, at most two days old", () => {
    const fetched = parseRecipeFile(file, NOW);
    expect(fetched.ok).toBe(true);
    expect(findRecipe(fetched, "EDDM", "2026-10-07", "J0_13h30")?.recipeDate).toBe("2026-10-07");
    expect(findRecipe(fetched, "EDDM", "2026-10-08", "J0_08h")?.recipeDate).toBe("2026-10-07");
    expect(findRecipe(fetched, "EDDM", "2026-10-10", "J0_08h")).toBeNull();
    expect(findRecipe(fetched, "LIMC", "2026-10-07", "J0_08h")).toBeNull();
  });

  it("rejects a stale or malformed file", () => {
    expect(parseRecipeFile(file, NOW + RECIPE_MAX_AGE_MS).ok).toBe(false);
    expect(parseRecipeFile({ foo: 1 }, NOW).ok).toBe(false);
  });
});

describe("bucketProbabilities", () => {
  it("sums integer probabilities into buckets, tails included", () => {
    const probs = [
      { k: 19, p: 0.1 },
      { k: 20, p: 0.3 },
      { k: 21, p: 0.4 },
      { k: 22, p: 0.2 },
    ];
    const p = bucketProbabilities(
      [
        { lo: null, hi: 19 },
        { lo: 20, hi: 20 },
        { lo: 21, hi: 21 },
        { lo: 22, hi: null },
      ],
      probs,
    );
    expect(p.map((x) => Number(x.toFixed(3)))).toEqual([0.1, 0.3, 0.4, 0.2]);
  });
});
