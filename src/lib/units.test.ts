import { describe, expect, it } from "vitest";
import { cToF, median, normalCdf } from "./units";

describe("probabilities", () => {
  it("normalCdf is symmetric and bounded", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
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
