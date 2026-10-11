import { describe, expect, it } from "vitest";
import { parseFmiSimple } from "./pws";

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
