import { describe, expect, it } from "vitest";
import { keepNewest, parseBuienradar, parseFmiSimple, parseMeteoFrance } from "./pws";
import type { PwsReading } from "./types";

function element(time: string, value: string, param = "t2m"): string {
  return `
    <wfs:member>
      <BsWfs:BsWfsElement gml:id="BsWfsElement.1.1.1">
        <BsWfs:Location><gml:Point><gml:pos>60.32937 24.97274 </gml:pos></gml:Point></BsWfs:Location>
        <BsWfs:Time>${time}</BsWfs:Time>
        <BsWfs:ParameterName>${param}</BsWfs:ParameterName>
        <BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>
      </BsWfs:BsWfsElement>
    </wfs:member>`;
}

function collection(...members: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection>${members.join("")}</wfs:FeatureCollection>`;
}

describe("FMI simple feature parsing", () => {
  it("returns the latest t2m reading", () => {
    const xml = collection(
      element("2026-10-11T17:40:00Z", "6.4"),
      element("2026-10-11T17:50:00Z", "6.5"),
      element("2026-10-11T18:00:00Z", "6.6"),
    );
    expect(parseFmiSimple(xml)).toEqual({ tempC: 6.6, obsTimeIso: "2026-10-11T18:00:00.000Z" });
  });

  it("skips NaN slots that are not reported yet", () => {
    const xml = collection(
      element("2026-10-11T18:00:00Z", "-1.2"),
      element("2026-10-11T18:10:00Z", "NaN"),
    );
    expect(parseFmiSimple(xml)).toEqual({ tempC: -1.2, obsTimeIso: "2026-10-11T18:00:00.000Z" });
  });

  it("ignores other parameters and empty responses", () => {
    expect(parseFmiSimple(collection(element("2026-10-11T18:00:00Z", "80", "rh")))).toEqual({
      tempC: null,
      obsTimeIso: null,
    });
    expect(parseFmiSimple(collection())).toEqual({ tempC: null, obsTimeIso: null });
  });
});

describe("Buienradar feed parsing", () => {
  const feed = {
    actual: {
      stationmeasurements: [
        { stationid: 6260, stationname: "Meetstation De Bilt", timestamp: "2026-10-11T20:00:00", temperature: 11.2 },
        { stationid: 6240, stationname: "Meetstation Schiphol", timestamp: "2026-10-11T20:00:00", temperature: 11.9 },
      ],
    },
  };

  it("picks the station and converts Amsterdam wall time to UTC", () => {
    expect(parseBuienradar(feed, 6240)).toEqual({
      name: "Schiphol",
      tempC: 11.9,
      obsTimeIso: "2026-10-11T18:00:00.000Z",
    });
  });

  it("throws when the station is missing", () => {
    expect(() => parseBuienradar(feed, 6370)).toThrow(/6370/);
  });
});

describe("Météo-France DPObs parsing", () => {
  it("converts kelvin to °C and reads the validity time", () => {
    const rows = [
      { validity_time: "2026-10-11T18:12:00Z", t: 288.15, t_10: 288.75 },
    ];
    expect(parseMeteoFrance(rows)).toEqual({ tempC: 15, obsTimeIso: "2026-10-11T18:12:00.000Z" });
    expect(parseMeteoFrance([{ validity_time: "2026-10-11T18:18:00Z", t: 271.05 }]).tempC).toBe(-2.1);
  });

  it("returns blanks for an empty or null reading", () => {
    expect(parseMeteoFrance([])).toEqual({ tempC: null, obsTimeIso: null });
    expect(parseMeteoFrance([{ validity_time: "2026-10-11T18:12:00Z", t: null }]).tempC).toBeNull();
  });
});

describe("keepNewest", () => {
  const reading = (obsTimeIso: string | null, tempC: number | null, ok = true): PwsReading => ({
    id: "100968",
    source: "fmi",
    url: "https://opendata.fmi.fi/wfs?fmisid=100968",
    name: null,
    tempC,
    obsTimeIso,
    ok,
  });

  it("keeps the previous reading when a backend serves an older slot", () => {
    const prev = [reading("2026-10-11T19:40:00.000Z", 6.4)];
    expect(keepNewest(prev, [reading("2026-10-11T19:30:00.000Z", 6.3)])).toEqual(prev);
  });

  it("takes newer readings and failures as they come", () => {
    const prev = [reading("2026-10-11T19:40:00.000Z", 6.4)];
    const newer = [reading("2026-10-11T19:50:00.000Z", 6.5)];
    expect(keepNewest(prev, newer)).toEqual(newer);
    const failed = [reading(null, null, false)];
    expect(keepNewest(prev, failed)).toEqual(failed);
    expect(keepNewest([], newer)).toEqual(newer);
  });
});
