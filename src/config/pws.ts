/**
 * Personal weather stations (PWS) near the resolution airports. They report
 * every few minutes, well before the next METAR, so they lead the official
 * observation. Grouped by market ICAO.
 */
export const PWS_STATIONS: Record<string, string[]> = {
  LFPB: ["https://www.awekas.at/fr/instrument.php?id=46887"],
  EDDM: [
    "https://www.awekas.at/fr/instrument.php?id=44077",
    "https://www.wunderground.com/dashboard/pws/IOBERD38",
  ],
  HKO: ["https://www.hko.gov.hk/en/wxinfo/awsgis/regional_portal.html"],
  // FMI open data, 10-minute obs from the Helsinki-Vantaa airport sensor itself.
  EFHK: [
    "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::simple&fmisid=100968&parameters=t2m",
  ],
};

export function pwsUrlsFor(icao: string): string[] {
  return PWS_STATIONS[icao.toUpperCase()] ?? [];
}
