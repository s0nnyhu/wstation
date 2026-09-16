import { describe, expect, it } from "vitest";
import { hoursUntilPeak, localNowHhMm, localNowHour } from "./time";

describe("hoursUntilPeak", () => {
  it("uses the payload clock, not wall time", () => {
    expect(hoursUntilPeak("2026-09-16T13:00:00", "2026-09-16T12:00:00")).toBe(1);
    expect(hoursUntilPeak("2026-09-16T13:00:00", "2026-09-16T12:06:00")).toBe(0.9);
  });

  it("returns null without a peak", () => {
    expect(hoursUntilPeak(undefined, "2026-09-16T12:00:00")).toBeNull();
  });
});

describe("localNow clock parts", () => {
  it("reads HH:MM from assemble localNow", () => {
    expect(localNowHhMm("2026-09-16T12:03:36")).toBe("12:03");
    expect(localNowHour("2026-09-16T12:03:36")).toBe(12);
  });
});
