import type { Region, Station } from "@/lib/types";

export const REGION_LABEL: Record<Region, string> = {
  europe: "Europe",
  asia: "Asia",
  america: "America",
};

export const STATIONS: Station[] = [
  {
    icao: "EHAM",
    city: "Amsterdam",
    name: "Amsterdam Schiphol",
    region: "europe",
    lat: 52.3086,
    lon: 4.7639,
    timezone: "Europe/Amsterdam",
    defaultUnit: "C",
    primary: "icon_seamless",
    primaryModels: ["icon_seamless"],
    backups: ["ukmo_seamless", "knmi_seamless"],
    domainExtras: ["knmi_harmonie_arome_netherlands"],
    notes: [
      "knmi_seamless already runs HARMONIE-AROME for the first 48 h; the pure HARMONIE NL run is only requested in Compare all.",
    ],
    warnings: [],
  },
  {
    icao: "LFPB",
    city: "Paris",
    name: "Paris Le Bourget",
    region: "europe",
    lat: 48.9694,
    lon: 2.4414,
    timezone: "Europe/Paris",
    defaultUnit: "C",
    primary: "icon_seamless",
    primaryModels: ["icon_seamless"],
    backups: [
      "meteofrance_seamless",
      "meteofrance_arome_france",
      "meteofrance_arome_france_hd",
      "ukmo_seamless",
    ],
    domainExtras: ["meteofrance_arome_france", "meteofrance_arome_france_hd"],
    notes: [],
    warnings: [],
  },
  {
    icao: "EDDM",
    city: "Munich",
    name: "Munich",
    region: "europe",
    lat: 48.3538,
    lon: 11.7861,
    timezone: "Europe/Berlin",
    defaultUnit: "C",
    primary: "icon_seamless",
    primaryModels: ["icon_seamless", "icon_eu"],
    shortRange: "icon_d2",
    h6Model: "icon_d2",
    backups: ["icon_eu", "meteofrance_seamless"],
    domainExtras: ["icon_d2", "icon_eu"],
    notes: [
      "Short-range primary is icon_d2; general primary is icon_seamless / icon_eu.",
    ],
    warnings: [],
  },
  {
    icao: "EGLC",
    city: "London",
    name: "London City",
    region: "europe",
    lat: 51.5053,
    lon: 0.0553,
    timezone: "Europe/London",
    defaultUnit: "C",
    primary: "ukmo_seamless",
    primaryModels: ["ukmo_seamless"],
    shortRange: "ukmo_uk_deterministic_2km",
    h6Model: "ukmo_uk_deterministic_2km",
    backups: ["icon_seamless"],
    domainExtras: ["ukmo_uk_deterministic_2km"],
    notes: [
      "UKMO open-data on Open-Meteo can lag ~4 hours — treat freshness accordingly.",
    ],
    warnings: [],
  },
  {
    icao: "LTAC",
    city: "Ankara",
    name: "Ankara Esenboğa",
    region: "europe",
    lat: 40.1281,
    lon: 32.9951,
    timezone: "Europe/Istanbul",
    defaultUnit: "C",
    primary: "gem_seamless",
    primaryModels: ["gem_seamless"],
    backups: ["meteofrance_seamless", "icon_seamless"],
    domainExtras: [],
    notes: [],
    warnings: [],
  },
  {
    icao: "LIMC",
    city: "Milan",
    name: "Milan Malpensa",
    region: "europe",
    lat: 45.6306,
    lon: 8.7281,
    timezone: "Europe/Rome",
    defaultUnit: "C",
    primary: "icon_seamless",
    primaryModels: ["icon_seamless"],
    backups: ["icon_eu", "knmi_seamless", "meteofrance_seamless"],
    domainExtras: ["icon_eu"],
    notes: [],
    warnings: [],
  },
  {
    icao: "EFHK",
    city: "Helsinki",
    name: "Helsinki-Vantaa",
    region: "europe",
    lat: 60.3172,
    lon: 24.9633,
    timezone: "Europe/Helsinki",
    defaultUnit: "C",
    primary: "knmi_seamless",
    primaryModels: ["knmi_seamless"],
    shortRange: "knmi_harmonie_arome_europe",
    h6Model: "knmi_harmonie_arome_europe",
    backups: ["icon_seamless"],
    domainExtras: ["knmi_harmonie_arome_europe"],
    notes: [
      "Primary is knmi_seamless; knmi_harmonie_arome_europe is the pure HARMONIE short-range option.",
    ],
    warnings: [],
  },
  {
    icao: "EPWA",
    city: "Warsaw",
    name: "Warsaw Chopin",
    region: "europe",
    lat: 52.1657,
    lon: 20.9671,
    timezone: "Europe/Warsaw",
    defaultUnit: "C",
    primary: "icon_seamless",
    primaryModels: ["icon_seamless", "icon_eu"],
    backups: ["icon_eu", "knmi_seamless", "gem_seamless"],
    domainExtras: ["icon_eu"],
    notes: [
      "icon_d2 is not requested here — poor coverage for Warsaw.",
    ],
    warnings: [],
  },
  {
    icao: "ZSPD",
    city: "Shanghai",
    name: "Shanghai Pudong",
    region: "asia",
    lat: 31.1434,
    lon: 121.8052,
    timezone: "Asia/Shanghai",
    defaultUnit: "C",
    primary: "ukmo_seamless",
    primaryModels: ["ukmo_seamless"],
    backups: ["icon_seamless", "ecmwf_ifs025"],
    domainExtras: ["jma_seamless", "cma_grapes_global"],
    notes: [
      "UKMO open-data on Open-Meteo can lag ~4 hours — treat freshness accordingly.",
      "WRH 2024–2026 study: UKMO H−0 MAE 0.76 °C; ICON is the 2024 winner and the SON backup.",
    ],
    warnings: [],
  },
  {
    icao: "ZGSZ",
    city: "Shenzhen",
    name: "Shenzhen Bao'an",
    region: "asia",
    lat: 22.6393,
    lon: 113.8107,
    timezone: "Asia/Shanghai",
    defaultUnit: "C",
    primary: "ecmwf_aifs025_single",
    primaryModels: ["ecmwf_aifs025_single"],
    backups: ["ecmwf_ifs025", "icon_seamless"],
    domainExtras: ["jma_seamless", "cma_grapes_global"],
    notes: [
      "AIFS archive starts ~2025 (n=575 vs 989 for IFS/ICON). IFS is the same ECMWF family — consensus counts one vote.",
      "Hourly METAR only (~24 obs/day) — WRH max is coarser than ZSPD/RJTT 30-minute feeds.",
    ],
    warnings: [],
  },
  {
    icao: "ZHHH",
    city: "Wuhan",
    name: "Wuhan Tianhe",
    region: "asia",
    lat: 30.7838,
    lon: 114.2081,
    timezone: "Asia/Shanghai",
    defaultUnit: "C",
    primary: "icon_seamless",
    primaryModels: ["icon_seamless"],
    backups: ["ecmwf_aifs025_single", "ecmwf_ifs025"],
    domainExtras: ["jma_seamless", "cma_grapes_global"],
    notes: [
      "WRH 2024–2026 study: ICON H−0 MAE 0.77 °C; AIFS is the seasonal backup and 2026 annual winner.",
    ],
    warnings: [],
  },
  {
    icao: "ZUUU",
    city: "Chengdu",
    name: "Chengdu Shuangliu",
    region: "asia",
    lat: 30.5785,
    lon: 103.9471,
    timezone: "Asia/Shanghai",
    defaultUnit: "C",
    primary: "ecmwf_aifs025_single",
    primaryModels: ["ecmwf_aifs025_single"],
    backups: ["icon_seamless", "ecmwf_ifs025"],
    domainExtras: ["jma_seamless", "cma_grapes_global"],
    notes: [
      "WRH 2024–2026 study: AIFS H−0 MAE 1.04 °C — noisier than Shanghai/Shenzhen.",
    ],
    warnings: [
      "Low exact hit-rate — require model consensus, do not trade a single model.",
    ],
  },
  {
    icao: "RJTT",
    city: "Tokyo",
    name: "Tokyo Haneda",
    region: "asia",
    lat: 35.5523,
    lon: 139.7798,
    timezone: "Asia/Tokyo",
    defaultUnit: "C",
    primary: "gfs_seamless",
    primaryModels: ["gfs_seamless"],
    backups: ["jma_seamless", "icon_seamless"],
    domainExtras: ["jma_msm", "cma_grapes_global"],
    notes: [
      "WRH 2024–2026 study: GFS H−0 MAE 0.81 °C; JMA Seamless is the annual backup (MSM nest).",
      "Settlement station is RJTT (Haneda), not RJAA (Narita).",
    ],
    warnings: [],
  },
  {
    icao: "KHOU",
    city: "Houston",
    name: "Houston Hobby",
    region: "america",
    lat: 29.6454,
    lon: -95.2789,
    timezone: "America/Chicago",
    defaultUnit: "F",
    primary: "gfs_seamless",
    primaryModels: ["gfs_hrrr", "gfs_seamless"],
    shortRange: "gfs_hrrr",
    h6Model: "gfs_hrrr",
    backups: ["icon_seamless"],
    domainExtras: ["gfs_hrrr"],
    notes: [
      "HRRR annual bias unavailable — gfs_seamless used as proxy.",
    ],
    warnings: [
      "Settlement station is KHOU (Hobby), not KIAH (Bush Intercontinental).",
    ],
  },
  {
    icao: "KDAL",
    city: "Dallas",
    name: "Dallas Love Field",
    region: "america",
    lat: 32.8471,
    lon: -96.8518,
    timezone: "America/Chicago",
    defaultUnit: "F",
    primary: "gfs_seamless",
    primaryModels: ["gfs_hrrr", "gfs_seamless"],
    shortRange: "gfs_hrrr",
    h6Model: "gfs_hrrr",
    backups: ["icon_seamless"],
    domainExtras: ["gfs_hrrr"],
    notes: [
      "HRRR annual bias unavailable — gfs_seamless used as proxy.",
    ],
    warnings: [
      "Settlement station is KDAL (Love Field), not KDFW (Dallas/Fort Worth).",
    ],
  },
  {
    icao: "KMIA",
    city: "Miami",
    name: "Miami",
    region: "america",
    lat: 25.7959,
    lon: -80.287,
    timezone: "America/New_York",
    defaultUnit: "F",
    primary: "gfs_seamless",
    primaryModels: ["gfs_hrrr", "gfs_seamless"],
    shortRange: "gfs_hrrr",
    h6Model: "gfs_hrrr",
    backups: ["gem_seamless"],
    domainExtras: ["gfs_hrrr"],
    notes: [
      "HRRR annual bias unavailable — gfs_seamless used as proxy.",
    ],
    warnings: [],
  },
  {
    icao: "KAUS",
    city: "Austin",
    name: "Austin",
    region: "america",
    lat: 30.1945,
    lon: -97.6699,
    timezone: "America/Chicago",
    defaultUnit: "F",
    primary: "gem_seamless",
    primaryModels: ["gfs_hrrr", "gem_seamless", "gfs_seamless"],
    shortRange: "gfs_hrrr",
    h6Model: "gfs_hrrr",
    backups: ["icon_seamless"],
    domainExtras: ["gfs_hrrr"],
    notes: [
      "HRRR annual bias unavailable in older notes — seasonal file is now the source of truth.",
    ],
    warnings: [
      "Low exact hit-rates / noisy station — require model consensus, do not trade a single model.",
    ],
  },
  {
    icao: "KLGA",
    city: "New York",
    name: "New York LaGuardia",
    region: "america",
    lat: 40.7772,
    lon: -73.8726,
    timezone: "America/New_York",
    defaultUnit: "F",
    primary: "gfs_seamless",
    primaryModels: ["gfs_hrrr", "gfs_seamless"],
    shortRange: "gfs_hrrr",
    h6Model: "gfs_hrrr",
    backups: ["icon_seamless"],
    domainExtras: ["gfs_hrrr"],
    notes: [
      "Strongest US Polymarket evidence for HRRR. HRRR annual bias unavailable — seamless used as proxy.",
    ],
    warnings: [
      "Settlement station is KLGA (LaGuardia), not KJFK or KEWR.",
    ],
  },
  {
    icao: "KSEA",
    city: "Seattle",
    name: "Seattle-Tacoma",
    region: "america",
    lat: 47.4502,
    lon: -122.3088,
    timezone: "America/Los_Angeles",
    defaultUnit: "F",
    primary: "gem_seamless",
    primaryModels: ["gem_hrdps_continental", "gem_seamless"],
    shortRange: "gem_hrdps_continental",
    h6Model: "gem_hrdps_continental",
    backups: ["gfs_seamless"],
    domainExtras: ["gem_hrdps_continental"],
    notes: [
      "GEM seasonal swing is large (DJF cold / JJA hot) — annual-only is the wrong tool here.",
    ],
    warnings: [
      "ASOS prefers GEM; Weather Underground prefers GFS — treat large GEM vs GFS splits as a disagreement flag.",
    ],
  },
];

/**
 * NOAA WRH timeseries — the page Polymarket names as resolution source
 * ("highest reading under the Temp column"). Data behind it is Synoptic.
 */
export function noaaTimeseriesUrl(icao: string, unit: "C" | "F" = "F"): string {
  const units = unit === "C" ? "metric" : "english";
  return `https://www.weather.gov/wrh/timeseries?site=${icao.toLowerCase()}&hours=48&units=${units}&obs=raw&hourly=false&pview=full`;
}

export const WU_RESOLUTION: Record<string, { wuStationId: string; wuCountry: string }> = {
  EHAM: { wuStationId: "EHAM", wuCountry: "NL" },
  LFPB: { wuStationId: "LFPB", wuCountry: "FR" },
  EDDM: { wuStationId: "EDDM", wuCountry: "DE" },
  EGLC: { wuStationId: "EGLC", wuCountry: "GB" },
  LTAC: { wuStationId: "LTAC", wuCountry: "TR" },
  LIMC: { wuStationId: "LIMC", wuCountry: "IT" },
  EFHK: { wuStationId: "EFHK", wuCountry: "FI" },
  EPWA: { wuStationId: "EPWA", wuCountry: "PL" },
  ZSPD: { wuStationId: "ZSPD", wuCountry: "CN" },
  ZGSZ: { wuStationId: "ZGSZ", wuCountry: "CN" },
  ZHHH: { wuStationId: "ZHHH", wuCountry: "CN" },
  ZUUU: { wuStationId: "ZUUU", wuCountry: "CN" },
  RJTT: { wuStationId: "RJTT", wuCountry: "JP" },
  KHOU: { wuStationId: "KHOU", wuCountry: "US" },
  KDAL: { wuStationId: "KDAL", wuCountry: "US" },
  KMIA: { wuStationId: "KMIA", wuCountry: "US" },
  KAUS: { wuStationId: "KAUS", wuCountry: "US" },
  KLGA: { wuStationId: "KLGA", wuCountry: "US" },
  KSEA: { wuStationId: "KSEA", wuCountry: "US" },
};

export function wuResolution(icao: string) {
  return WU_RESOLUTION[icao.trim().toUpperCase()];
}

export function wuHistoryUrl(icao: string, dateIso: string): string {
  const [y, m, d] = dateIso.split("-");
  return `https://www.wunderground.com/history/daily/${icao}/date/${Number(y)}-${Number(m)}-${Number(d)}`;
}

export function wuForecastUrl(icao: string): string {
  return `https://www.wunderground.com/forecast/${icao}`;
}

/** Polymarket event city slugs — verified against gamma-api event slugs. */
export const POLYMARKET_CITY: Record<string, string> = {
  EHAM: "amsterdam",
  LFPB: "paris",
  EDDM: "munich",
  EGLC: "london",
  LTAC: "ankara",
  LIMC: "milan",
  EFHK: "helsinki",
  EPWA: "warsaw",
  ZSPD: "shanghai",
  ZGSZ: "shenzhen",
  ZHHH: "wuhan",
  ZUUU: "chengdu",
  RJTT: "tokyo",
  KHOU: "houston",
  KDAL: "dallas",
  KMIA: "miami",
  KAUS: "austin",
  KLGA: "nyc",
  KSEA: "seattle",
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function polymarketEventSlug(icao: string, dateIso: string): string | undefined {
  const city = POLYMARKET_CITY[icao.trim().toUpperCase()];
  if (!city) return undefined;
  const [y, m, d] = dateIso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return `highest-temperature-in-${city}-on-${MONTHS[m - 1]}-${d}-${y}`;
}

export function polymarketEventUrl(icao: string, dateIso: string): string | undefined {
  const slug = polymarketEventSlug(icao, dateIso);
  return slug ? `https://polymarket.com/event/${slug}` : undefined;
}

const byIcao = new Map(STATIONS.map((s) => [s.icao, s]));

export function getStation(icao: string): Station | undefined {
  return byIcao.get(icao.trim().toUpperCase());
}

export function listStations(): Station[] {
  return STATIONS;
}
