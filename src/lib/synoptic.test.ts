import { describe, expect, it } from "vitest";
import { noaaStyleMax } from "./synoptic";

describe("noaaStyleMax", () => {
  // Real KSEA shape on 2026-09-11: 5-minute integer-°C obs plus :53 METARs
  // with tenths. Times are UTC; Seattle is UTC−7.
  const series = {
    times: [
      "2026-09-11T06:53:00Z", // 23:53 local, 10 Sep → previous market day
      "2026-09-11T18:40:00Z", // 17 °C five-minute ob → 62.6 → 63 °F
      "2026-09-11T18:53:00Z", // 16.1 °C METAR → 60.98 → 61 °F
      "2026-09-11T22:55:00Z", // 19 °C → 66.2 → 66 °F
      "2026-09-11T23:53:00Z", // 18.9 °C → 66.02 → 66 °F
    ],
    tempsC: [25, 17, 16.1, 19, 18.9],
  };

  it("rounds each observation in the market unit and takes the day max", () => {
    const r = noaaStyleMax(series, "America/Los_Angeles", "2026-09-11", "F");
    expect(r.resolutionMax).toBe(66);
    expect(r.resolutionMaxAt).toBe("2026-09-11T22:55:00Z");
    expect(r.maxC).toBe(19);
    expect(r.observationCount).toBe(4);
    expect(r.latestC).toBe(18.9);
  });

  it("works in Celsius for European markets", () => {
    const r = noaaStyleMax(
      { times: ["2026-09-12T12:20:00Z", "2026-09-12T13:20:00Z"], tempsC: [22, 23] },
      "Europe/London",
      "2026-09-12",
      "C",
    );
    expect(r.resolutionMax).toBe(23);
  });

  it("five-minute integer obs can beat the hourly tenths max", () => {
    const r = noaaStyleMax(
      { times: ["2026-09-11T18:40:00Z", "2026-09-11T18:53:00Z"], tempsC: [17, 16.1] },
      "America/Los_Angeles",
      "2026-09-11",
      "F",
    );
    expect(r.resolutionMax).toBe(63);
    expect(Math.round((16.1 * 9) / 5 + 32)).toBe(61);
  });
});
