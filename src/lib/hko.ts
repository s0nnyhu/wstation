import { cacheGet, cacheSet, STALE_MAX_MS } from "./cache";
import { fetchWithBackoff } from "./http";
import type { MetarLatest, MetarPayload } from "./types";

/**
 * Hong Kong resolves on the Hong Kong Observatory HQ (Tsim Sha Tsui) "Absolute
 * Daily Max" — not on a VHHH METAR. We read the Observatory's own open-data
 * CSVs (1-minute temperature and max since midnight, both in HKT, tenths).
 */
const BASE = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather";
const STATION_NAME = "HK Observatory";
const USER_AGENT = "WStation/0.1 (local Polymarket weather dashboard)";

interface HkoRow {
  at: string;
  values: number[];
}

/** `202610060240` (HKT) → ISO UTC. */
function hktToIso(stamp: string): string | null {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function fetchRow(file: string): Promise<HkoRow> {
  const res = await fetchWithBackoff(
    `${BASE}/${file}`,
    { headers: { Accept: "text/csv", "User-Agent": USER_AGENT } },
    { timeoutMs: 8_000, retries: 1 },
  );
  if (!res.ok) throw new Error(`HKO HTTP ${res.status}`);
  const line = (await res.text())
    .split(/\r?\n/)
    .map((l) => l.split(","))
    .find((cols) => cols[1]?.trim() === STATION_NAME);
  const at = line ? hktToIso(line[0].trim()) : null;
  if (!line || !at) throw new Error(`HKO: no ${STATION_NAME} row in ${file}`);
  return { at, values: line.slice(2).map(Number) };
}

export async function fetchHko(
  timezone: string,
  marketDate: string,
): Promise<MetarPayload> {
  const cacheKey = "hko:v1";
  const cached = cacheGet<MetarPayload>(cacheKey, STALE_MAX_MS);
  try {
    const [now, maxmin] = await Promise.all([
      fetchRow("latest_1min_temperature.csv"),
      fetchRow("latest_since_midnight_maxmin.csv"),
    ]);
    const tempC = now.values[0];
    if (!Number.isFinite(tempC)) throw new Error("HKO: temperature missing");
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(new Date(maxmin.at));
    const sameDay = today === marketDate;
    const maxC = sameDay && Number.isFinite(maxmin.values[0]) ? maxmin.values[0] : null;
    const latest: MetarLatest = {
      tempC,
      tempBodyC: Math.round(tempC),
      dewpointC: null,
      observedAt: now.at,
      raw: `HKO Observatory 1-min AWS: ${tempC.toFixed(1)}°C`,
      name: "Hong Kong Observatory",
      icon: "partly",
    };
    const payload: MetarPayload = {
      ok: true,
      latest,
      observationCount: 1,
      declining: false,
      fetchedAt: new Date().toISOString(),
      stale: false,
      runningMaxC: maxC,
      runningMaxAt: maxC == null ? null : maxmin.at,
      resolutionMaxC: maxC,
      observations: sameDay
        ? [{ at: now.at, tempC, icon: latest.icon ?? "partly" }]
        : [],
    };
    cacheSet(cacheKey, payload);
    return payload;
  } catch (error) {
    if (cached) {
      return {
        ...cached.value,
        stale: true,
        error: `Serving cached HKO (${error instanceof Error ? error.message : "upstream failure"})`,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "HKO fetch failed",
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }
}
