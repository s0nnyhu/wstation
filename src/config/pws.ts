/**
 * Personal weather stations (PWS) near the resolution airports. They report
 * every few minutes, well before the next METAR, so they lead the official
 * observation. Grouped by market ICAO.
 */
export const PWS_STATIONS: Record<string, string[]> = {
  LFPB: [
    "https://www.awekas.at/fr/instrument.php?id=46887",
    // Météo-France 6-minute obs from the Le Bourget airport sensor (needs METEO_FRANCE_API_KEY).
    "https://public-api.meteofrance.fr/public/DPObs/v2/station/infrahoraire-6m?id_station=95088001&format=json",
  ],
  EDDM: [
    "https://www.awekas.at/fr/instrument.php?id=44077",
    "https://www.wunderground.com/dashboard/pws/IOBERD38",
  ],
  HKO: ["https://www.hko.gov.hk/en/wxinfo/awsgis/regional_portal.html"],
  // FMI open data, 10-minute obs from the Helsinki-Vantaa airport sensor itself.
  EFHK: [
    "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::simple&fmisid=100968&parameters=t2m",
  ],
  // KNMI Schiphol (06240) 10-minute obs, republished by Buienradar without a key.
  EHAM: ["https://data.buienradar.nl/2.0/feed/json?stationid=6240"],
};

export function pwsUrlsFor(icao: string): string[] {
  return PWS_STATIONS[icao.toUpperCase()] ?? [];
}
