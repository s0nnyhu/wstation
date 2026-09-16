import { describe, expect, it } from "vitest";
import { hoursUntilPeak, localNowHhMm, localNowHour, utcZLabel, zonedHhMm } from "./time";

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

describe("utcZLabel / zonedHhMm", () => {
  it("labels a UTC init hour as 09Z", () => {
    expect(utcZLabel("2026-09-16T09:00:00.000Z")).toBe("09Z");
    expect(utcZLabel("2026-09-16T00:00:00.000Z")).toBe("00Z");
  });

  it("converts init time into station-local HH:MM", () => {
    expect(zonedHhMm("2026-09-16T09:00:00.000Z", "Europe/Paris")).toBe("11:00");
    expect(zonedHhMm("2026-09-16T09:00:00.000Z", "Europe/London")).toBe("10:00");
  });
});
