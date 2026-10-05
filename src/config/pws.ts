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
};

export function pwsUrlsFor(icao: string): string[] {
  return PWS_STATIONS[icao.toUpperCase()] ?? [];
}
