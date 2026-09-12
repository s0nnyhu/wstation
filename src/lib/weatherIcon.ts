export type WeatherIconKind =
  | "clear"
  | "partly"
  | "cloudy"
  | "rain"
  | "thunder"
  | "fog"
  | "night";

/** Open-Meteo WMO weather codes. */
export function iconFromWmo(code: number | null | undefined, night = false): WeatherIconKind {
  if (code == null) return night ? "night" : "partly";
  if (code === 0) return night ? "night" : "clear";
  if (code <= 3) return "partly";
  if (code >= 95) return "thunder";
  if (code >= 51) return "rain";
  if (code >= 45) return "fog";
  return night ? "night" : "partly";
}

/**
 * Weather.com / WU iconCode (The Weather Company set).
 * https://docs.google.com — standard TWC icon list 0–47.
 */
export function iconFromTwc(
  code: number | null | undefined,
  dayOrNight?: string | null,
): WeatherIconKind {
  const night = dayOrNight === "N";
  if (code == null) return night ? "night" : "partly";
  if ([3, 4, 37, 38, 47].includes(code)) return "thunder";
  if ([5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 39, 40, 41, 42, 43, 45, 46].includes(code)) {
    return "rain";
  }
  if ([19, 20, 21, 22].includes(code)) return "fog";
  if ([26, 27, 28].includes(code)) return "cloudy";
  if ([29, 30].includes(code)) return "partly";
  if ([31, 33].includes(code)) return "night";
  if ([32, 34, 36].includes(code)) return "clear";
  return night ? "night" : "partly";
}

export function iconFromPhrase(phrase: string | null | undefined, night = false): WeatherIconKind {
  if (!phrase) return night ? "night" : "partly";
  const p = phrase.toLowerCase();
  if (p.includes("thunder") || p.includes("t-storm") || p.includes("lightning")) return "thunder";
  if (p.includes("rain") || p.includes("shower") || p.includes("drizzle") || p.includes("snow")) {
    return "rain";
  }
  if (p.includes("fog") || p.includes("mist") || p.includes("haze")) return "fog";
  if (p.includes("overcast") || p === "cloudy" || p.includes("m cloudy")) return "cloudy";
  if (p.includes("partly") || p.includes("p cloudy") || p.includes("few")) return "partly";
  if (p.includes("fair") || p.includes("sunny") || p.includes("clear")) {
    return night ? "night" : "clear";
  }
  return night ? "night" : "partly";
}

/** METAR sky / significant weather from the raw string or cover token. */
export function iconFromMetar(raw: string | undefined, cover?: string | null): WeatherIconKind {
  const text = `${raw ?? ""} ${cover ?? ""}`.toUpperCase();
  if (/\bTS|\bTSRA|\bVCTS/.test(text)) return "thunder";
  if (/\b(?:RA|SN|DZ|SHRA|SHSN)\b/.test(text)) return "rain";
  if (/\b(?:FG|BR|HZ)\b/.test(text)) return "fog";
  if (/\b(?:OVC|BKN|VV)/.test(text) || cover === "OVC" || cover === "BKN") return "cloudy";
  if (/\b(?:SCT|FEW)/.test(text) || cover === "SCT" || cover === "FEW") return "partly";
  if (/\bCAVOK\b|\bSKC\b|\bCLR\b|\bNSC\b/.test(text) || cover === "CLR" || cover === "SKC") {
    return "clear";
  }
  return "partly";
}

export function parseMetarSky(raw: string | undefined, cover?: string | null): string | null {
  if (!raw) return cover ?? null;
  if (/\bCAVOK\b/.test(raw)) return "CAVOK";
  const clouds = raw.match(/\b(?:FEW|SCT|BKN|OVC|VV)\d{3}(?:[A-Z]{2,3})?/g);
  if (clouds?.length) return clouds.slice(0, 3).join(" ");
  if (cover && cover !== "CLR") return cover;
  if (/\b(?:SKC|CLR|NSC)\b/.test(raw) || cover === "CLR") return "CLR";
  return cover ?? null;
}
