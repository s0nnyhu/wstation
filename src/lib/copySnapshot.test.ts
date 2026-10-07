import { describe, expect, it } from "vitest";
import { formatStationClipboard, pickPolymarketFavorite } from "./copySnapshot";
import { ensemblePayload } from "./testFixtures";
import type { PolymarketBucket, StationPayload } from "./types";

function bucket(
  label: string,
  yesPrice: number | null,
  lo: number,
  hi: number,
): PolymarketBucket {
  return {
    label,
    lo,
    hi,
    unit: "C",
    yesPrice,
    bestBid: yesPrice,
    bestAsk: yesPrice,
  };
}

function payload(overrides: Partial<StationPayload> = {}): StationPayload {
  const data = ensemblePayload(overrides);
  data.polymarket.buckets = [
    bucket("25°C", 0.12, 25, 25),
    bucket("26°C", 0.41, 26, 26),
    bucket("27°C", 0.18, 27, 27),
  ];
  return data;
}

describe("pickPolymarketFavorite", () => {
  it("picks the highest yes price", () => {
    const fav = pickPolymarketFavorite(payload().polymarket.buckets);
    expect(fav?.label).toBe("26°C");
  });

  it("returns null when nothing is priced", () => {
    expect(pickPolymarketFavorite([bucket("26°C", null, 26, 26)])).toBeNull();
  });
});

describe("formatStationClipboard", () => {
  it("formats a compact snapshot in the display unit", () => {
    const text = formatStationClipboard(
      payload(),
      "C",
      new Date("2026-09-16T09:58:12.000Z"),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("Munich (EDDM) · now");
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(lines[2]).toBe("WU 26.0°C");
    expect(lines[3]).toBe("Husky 25.0°C");
    expect(lines[4]).toBe("METAR 25.0°C");
    expect(lines[5]).toBe("Blend 25.4°C · most likely 26°C (41%) · 80% 25–27°C · J0_10h30");
    expect(lines[6]).toBe("ICON-D2 25.9°C corr 06Z");
    expect(lines[7]).toBe("AROME France HD 24.9°C corr");
    expect(lines[8]).toBe("Buckets 25°C (25°C · 26°C)");
    expect(lines[9]).toBe("Favorite 26°C (41¢)");
    expect(text).not.toContain("ICON global");
  });

  it("says when there is no calibrated correction", () => {
    const data = payload();
    data.forecast.ensemble = null;
    data.forecast.headlineKind = "raw-median";
    const text = formatStationClipboard(data, "C", new Date("2026-09-16T09:58:12.000Z"));
    expect(text).toContain("Raw median 25.4°C (no calibrated correction)");
  });

  it("uses em dashes when WU, Husky or the market are missing", () => {
    const data = payload();
    data.wu.ok = false;
    data.husky.ok = false;
    data.polymarket.ok = false;
    const text = formatStationClipboard(
      data,
      "C",
      new Date("2026-09-16T09:58:12.000Z"),
    );
    expect(text).toContain("WU —");
    expect(text).toContain("Husky —");
    expect(text).toContain("Favorite —");
  });

  it("omits the METAR running high for tomorrow", () => {
    const data = payload();
    data.day = "tomorrow";
    const text = formatStationClipboard(
      data,
      "C",
      new Date("2026-09-16T09:58:12.000Z"),
    );
    expect(text).toContain("Munich (EDDM) · tomorrow");
    expect(text).toContain("METAR —");
  });
});
