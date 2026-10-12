import type { MetarLatest, TempUnit } from "./types";
import { formatTemp } from "./units";
import type { WeatherIconKind } from "./weatherIcon";

/**
 * Plain-language summary of the current METAR: sky, present weather,
 * visibility, wind and feels-like. Only the observation part is read —
 * trend groups (TEMPO, BECMG, NOSIG…) and remarks are forecasts or extras.
 */
export interface MetarConditions {
  icon: WeatherIconKind;
  parts: string[];
}

const INTENSITY: Record<string, string> = { "-": "light", "+": "heavy" };

const DESCRIPTOR: Record<string, string> = {
  MI: "shallow",
  BC: "patches of",
  PR: "partial",
  DR: "drifting",
  BL: "blowing",
  FZ: "freezing",
};

const PHENOMENON: Record<string, string> = {
  DZ: "drizzle",
  RA: "rain",
  SN: "snow",
  SG: "snow grains",
  IC: "ice crystals",
  PL: "ice pellets",
  GR: "hail",
  GS: "small hail",
  UP: "precipitation",
  BR: "mist",
  FG: "fog",
  FU: "smoke",
  VA: "volcanic ash",
  DU: "dust",
  SA: "sand",
  HZ: "haze",
  PY: "spray",
  PO: "dust whirls",
  SQ: "squalls",
  FC: "funnel cloud",
  SS: "sandstorm",
  DS: "duststorm",
};

const WEATHER_TOKEN =
  /^(RE)?(-|\+|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/;

const CLOUD_TOKEN = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/;
const COVER_RANK: Record<string, number> = { FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 5 };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Observation tokens only: no METAR/SPECI header, trend groups or remarks. */
export function metarBodyTokens(raw: string): string[] {
  const body = raw.split(/\s(?:TEMPO|BECMG|NOSIG|RMK|PROB\d{2}|FM\d{4,6})\b/)[0];
  return body
    .trim()
    .split(/\s+/)
    .filter((t, i) => !(i === 0 && (t === "METAR" || t === "SPECI")));
}

/** One present-weather group (`-SHRA`, `VCTS`, `BR`…) in words, or null. */
export function decodeWeatherToken(token: string): string | null {
  const m = token.match(WEATHER_TOKEN);
  if (!m) return null;
  const [, recent, intensity, descriptor, phenomena] = m;
  if (!descriptor && !phenomena) return null;
  const nouns = (phenomena.match(/../g) ?? []).map((code) => PHENOMENON[code]);
  const what = nouns.join(" and ");
  // Intensity qualifies the precipitation: -TSRA is a thunderstorm with light rain.
  const level = intensity && INTENSITY[intensity] ? `${INTENSITY[intensity]} ` : "";
  let text: string;
  if (descriptor === "TS") text = what ? `thunderstorm with ${level}${what}` : "thunderstorm";
  else if (descriptor === "SH") text = `${level}${what ? `${what} showers` : "showers"}`;
  else if (descriptor) text = `${level}${DESCRIPTOR[descriptor]} ${what}`.trim();
  else text = `${level}${what}`;
  if (intensity === "VC") text = `${text} nearby`;
  if (recent) text = `recent ${text}`;
  return capitalize(text);
}

/** Solar elevation in degrees (low-precision NOAA approximation, ±0.5°). */
export function solarElevationDeg(lat: number, lon: number, at: Date): number {
  const rad = Math.PI / 180;
  const d = at.getTime() / 86_400_000 - 10_957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = 18.697374558 + 24.06570982441908 * d;
  const ha = (gmst * 15 + lon - ra) * rad;
  const elev = Math.asin(
    Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha),
  );
  return elev / rad;
}

function skyPhrase(tokens: string[], day: boolean): { text: string | null; rank: number } {
  if (tokens.includes("CAVOK") || tokens.some((t) => /^(SKC|CLR|NSC|NCD)$/.test(t))) {
    return { text: day ? "Sunny" : "Clear sky", rank: 0 };
  }
  let rank = -1;
  const convective = new Set<string>();
  for (const t of tokens) {
    const m = t.match(CLOUD_TOKEN);
    if (!m) continue;
    rank = Math.max(rank, COVER_RANK[m[1]]);
    if (m[3] === "CB") convective.add("cumulonimbus");
    if (m[3] === "TCU") convective.add("towering cumulus");
  }
  if (rank < 0) return { text: null, rank };
  const base = [
    "",
    day ? "Mostly sunny" : "Mostly clear",
    "Partly cloudy",
    "Mostly cloudy",
    "Overcast",
    "Sky obscured",
  ][rank];
  const extra = convective.size ? `, ${[...convective].join(" and ")} around` : "";
  return { text: `${base}${extra}`, rank };
}

function visibilityPhrase(tokens: string[]): string | null {
  if (tokens.includes("CAVOK")) return null;
  for (const t of tokens) {
    const metres = t.match(/^(\d{4})(?:NDV)?$/);
    if (metres) {
      const m = Number(metres[1]);
      if (m >= 5000) return null;
      return m < 1000 ? `Very poor visibility ${m} m` : `Poor visibility ${(m / 1000).toFixed(1)} km`;
    }
  }
  // US statute miles, possibly split in two tokens: "10SM", "1/2SM", "1 1/2SM", "M1/4SM".
  const miles = tokens.join(" ").match(/(?:^|\s)M?(?:(\d+) )?(\d+)(?:\/(\d+))?SM(?=\s|$)/);
  if (miles) {
    const frac = miles[3] ? Number(miles[2]) / Number(miles[3]) : Number(miles[2]);
    const mi = (miles[1] ? Number(miles[1]) : 0) + frac;
    if (mi >= 3) return null;
    return `${mi < 0.6 ? "Very poor" : "Poor"} visibility ${mi.toFixed(mi < 1 ? 2 : 1)} mi`;
  }
  return null;
}

const CARDINAL = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function windPhrase(m: MetarLatest, unit: TempUnit): string | null {
  const kt = m.windSpeedKt;
  if (kt == null) return null;
  if (kt < 3) return "Calm";
  const label =
    kt < 11 ? "Light wind" : kt < 17 ? "Moderate wind" : kt < 22 ? "Fresh wind" : kt < 28 ? "Strong wind" : "Gale";
  const speed = (v: number) =>
    unit === "F" ? `${Math.round(v * 1.15078)} mph` : `${Math.round(v * 1.852)} km/h`;
  const gust = m.windGustKt != null && m.windGustKt > kt ? `, gusts ${speed(m.windGustKt)}` : "";
  if (m.windDirDeg == null) {
    return `${label.replace(/ wind$/, " variable wind")} ${speed(kt)}${gust}`;
  }
  return `${label} from ${CARDINAL[Math.round(m.windDirDeg / 45) % 8]} ${speed(kt)}${gust}`;
}

/** Wind chill (Environment Canada) and heat index (NOAA Rothfusz), °C. */
function feelsLikePhrase(m: MetarLatest, unit: TempUnit): string | null {
  const t = m.tempC;
  const kmh = (m.windSpeedKt ?? 0) * 1.852;
  if (t <= 10 && kmh > 4.8) {
    const v = kmh ** 0.16;
    const wc = 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
    if (t - wc >= 1) return `Cold wind, feels like ${formatTemp(wc, unit, 0)}`;
  }
  const rh = m.humidityPct;
  if (t >= 27 && rh != null && rh >= 40) {
    const f = (t * 9) / 5 + 32;
    const hiF =
      -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f -
      0.05481717 * rh * rh + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh -
      0.00000199 * f * f * rh * rh;
    const hiC = ((hiF - 32) * 5) / 9;
    if (hiC - t >= 1) return `Humid, feels like ${formatTemp(hiC, unit, 0)}`;
  }
  return null;
}

export function describeMetar(
  m: MetarLatest,
  opts: { lat: number; lon: number; unit: TempUnit },
): MetarConditions {
  const tokens = metarBodyTokens(m.raw);
  const day = solarElevationDeg(opts.lat, opts.lon, new Date(m.observedAt)) > -0.833;
  const sky = skyPhrase(tokens, day);
  // Skip the header tokens (station, time) so e.g. "BR" in an ICAO never matches.
  const weather = tokens
    .slice(2)
    .map(decodeWeatherToken)
    .filter((w): w is string => w != null);
  const parts = [
    sky.text,
    ...weather,
    visibilityPhrase(tokens),
    windPhrase(m, opts.unit),
    feelsLikePhrase(m, opts.unit),
  ].filter((p): p is string => !!p);

  const text = weather.join(" ").toLowerCase();
  const icon: WeatherIconKind = /thunder/.test(text)
    ? "thunder"
    : /rain|drizzle|snow|showers|hail|pellets/.test(text)
      ? "rain"
      : /fog|mist|haze|smoke/.test(text) && sky.rank <= 2
        ? "fog"
        : sky.rank >= 3
          ? "cloudy"
          : sky.rank >= 1
            ? "partly"
            : day
              ? "clear"
              : "night";
  return { icon, parts };
}
