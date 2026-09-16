import { describe, expect, it } from "vitest";
import {
  bucketIndexFor,
  bucketProbabilities,
  cToF,
  fallbackBucketStep,
  fallbackBuckets,
  formatBucketRange,
  median,
  normalCdf,
  sigmaFromMae,
} from "./units";

describe("fallback buckets", () => {
  it("uses 2 °F even-aligned ranges for American markets", () => {
    expect(fallbackBucketStep("america", "F")).toBe(2);
    expect(fallbackBuckets(79, 2)).toEqual([
      { lo: 76, hi: 77 },
      { lo: 78, hi: 79 },
      { lo: 80, hi: 81 },
    ]);
    expect(fallbackBuckets(78, 2)[1]).toEqual({ lo: 78, hi: 79 });
  });

  it("uses 1 °C single values for European and Asian markets", () => {
    expect(fallbackBucketStep("europe", "C")).toBe(1);
    expect(fallbackBucketStep("asia", "C")).toBe(1);
    expect(fallbackBuckets(23, 1)).toEqual([
      { lo: 22, hi: 22 },
      { lo: 23, hi: 23 },
      { lo: 24, hi: 24 },
    ]);
    expect(formatBucketRange({ lo: 23, hi: 23 }, "C")).toBe("23°C");
    expect(formatBucketRange({ lo: 78, hi: 79 }, "F")).toBe("78-79°F");
  });

  it("handles negative temperatures with even alignment", () => {
    expect(fallbackBuckets(-3, 2)[1]).toEqual({ lo: -4, hi: -3 });
  });
});

describe("bucketIndexFor", () => {
  const buckets = [
    { lo: null, hi: 69 },
    { lo: 70, hi: 71 },
    { lo: 72, hi: 73 },
    { lo: 74, hi: null },
  ];

  it("finds inclusive ranges and open tails", () => {
    expect(bucketIndexFor(buckets, 60)).toBe(0);
    expect(bucketIndexFor(buckets, 69)).toBe(0);
    expect(bucketIndexFor(buckets, 70)).toBe(1);
    expect(bucketIndexFor(buckets, 71)).toBe(1);
    expect(bucketIndexFor(buckets, 72)).toBe(2);
    expect(bucketIndexFor(buckets, 74)).toBe(3);
    expect(bucketIndexFor(buckets, 99)).toBe(3);
  });

  it("returns -1 when no bucket matches", () => {
    expect(bucketIndexFor([{ lo: 10, hi: 11 }], 12)).toBe(-1);
  });
});

describe("probabilities", () => {
  it("normalCdf is symmetric and bounded", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("sigmaFromMae uses sqrt(pi/2)", () => {
    expect(sigmaFromMae(1)).toBeCloseTo(1.2533, 3);
  });

  it("bucket probabilities sum to 1 over a full partition", () => {
    const buckets = [
      { lo: null, hi: 69 },
      { lo: 70, hi: 71 },
      { lo: 72, hi: 73 },
      { lo: 74, hi: 75 },
      { lo: 76, hi: null },
    ];
    const p = bucketProbabilities(buckets, 72.4, 1.5);
    expect(p).not.toBeNull();
    const sum = (p as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // The bucket containing the mean is the most likely one.
    const argmax = (p as number[]).indexOf(Math.max(...(p as number[])));
    expect(argmax).toBe(2);
  });

  it("returns null for an unusable sigma", () => {
    expect(bucketProbabilities([{ lo: 1, hi: 2 }], 1.5, 0)).toBeNull();
    expect(bucketProbabilities([{ lo: 1, hi: 2 }], Number.NaN, 1)).toBeNull();
  });
});

describe("misc", () => {
  it("median handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("cToF converts the resolution-critical integers as NOAA does", () => {
    // ASOS 5-minute obs are integer °C; NOAA shows Math.round(°F).
    expect(Math.round(cToF(19))).toBe(66);
    expect(Math.round(cToF(27))).toBe(81);
    expect(Math.round(cToF(26.7))).toBe(80);
  });
});
