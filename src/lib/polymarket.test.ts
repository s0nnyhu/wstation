import { describe, expect, it } from "vitest";
import { parseBucketLabel } from "./polymarket";

describe("parseBucketLabel", () => {
  it("parses US 2 °F ranges and tails", () => {
    expect(parseBucketLabel("69°F or below")).toEqual({ lo: null, hi: 69, unit: "F" });
    expect(parseBucketLabel("70-71°F")).toEqual({ lo: 70, hi: 71, unit: "F" });
    expect(parseBucketLabel("88°F or higher")).toEqual({ lo: 88, hi: null, unit: "F" });
  });

  it("parses European single-degree buckets", () => {
    expect(parseBucketLabel("17°C or below")).toEqual({ lo: null, hi: 17, unit: "C" });
    expect(parseBucketLabel("23°C")).toEqual({ lo: 23, hi: 23, unit: "C" });
    expect(parseBucketLabel("27°C or higher")).toEqual({ lo: 27, hi: null, unit: "C" });
  });

  it("handles negatives, en dashes and 'above'", () => {
    expect(parseBucketLabel("-3°C")).toEqual({ lo: -3, hi: -3, unit: "C" });
    expect(parseBucketLabel("-4--3°C")).toEqual({ lo: -4, hi: -3, unit: "C" });
    expect(parseBucketLabel("70–71°F")).toEqual({ lo: 70, hi: 71, unit: "F" });
    expect(parseBucketLabel("88°F or above")).toEqual({ lo: 88, hi: null, unit: "F" });
  });

  it("rejects labels that are not temperature buckets", () => {
    expect(parseBucketLabel("Yes")).toBeNull();
    expect(parseBucketLabel("Will it rain?")).toBeNull();
  });
});
