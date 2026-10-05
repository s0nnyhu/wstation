import { pwsUrlsFor } from "@/config/pws";
import { cacheGet, cacheSet, PWS_TTL_MS } from "./cache";
import { fetchRow } from "./hko";
import { fetchWithBackoff } from "./http";
import type { PwsPayload, PwsReading } from "./types";
import { wuApiKey } from "./wu";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

type Hit = Pick<PwsReading, "name" | "tempC" | "obsTimeIso">;

export function wuPwsIdFromUrl(url: string): string {
  const m = new URL(url).pathname.match(/\/pws\/([A-Za-z0-9]+)/i);
  return m?.[1] ?? "";
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function epochToIso(v: string | number | null | undefined): string | null {
  const n = toNum(v);
  if (n == null || n <= 0) return null;
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function getText(url: string, headers: Record<string, string>, timeoutMs: number) {
  const res = await fetchWithBackoff(
    url,
    { headers: { "User-Agent": USER_AGENT, ...headers } },
    { timeoutMs, retries: 0 },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- AWEKAS -------------------------------------------------------------

interface AwekasData {
  status?: number | string;
  data?: Array<number | string | null>;
  reporttime?: string | number | null;
}

async function loadAwekas(url: string): Promise<{ html: string; json: AwekasData }> {
  const html = await getText(url, { Accept: "text/html,application/xhtml+xml" }, 8_000);
  const secid = html.match(/var\s+secid\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (!secid) throw new Error("AWEKAS secid not found");
  const text = await getText(
    `https://www.awekas.at/common/ajax_instrument_data.php4?secid=${secid}&teh=c`,
    { Accept: "*/*", Referer: "https://www.awekas.at/" },
    8_000,
  );
  return { html, json: JSON.parse(text) as AwekasData };
}

async function fetchAwekas(url: string): Promise<Hit> {
  let page = await loadAwekas(url);
  // The first secid is sometimes rejected; a fresh page load fixes it.
  if (String(page.json.status) !== "1") page = await loadAwekas(url);
  if (String(page.json.status) !== "1") {
    throw new Error(`AWEKAS status ${page.json.status ?? "?"}`);
  }
  const name = (
    page.html.match(/de la station\s+([^<]+)/i) ??
    page.html.match(/station\.php\?id=\d+[^>]*>([^<]+)</i)
  )?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  return {
    name: name || null,
    tempC: toNum(page.json.data?.[0]),
    obsTimeIso: epochToIso(page.json.reporttime),
  };
}

// ---- Wunderground PWS ---------------------------------------------------

interface WuPwsResponse {
  observations?: Array<{
    obsTimeUtc?: string | null;
    neighborhood?: string | null;
    metric?: { temp?: number | null };
  }>;
}

async function fetchWu(url: string): Promise<Hit> {
  const id = wuPwsIdFromUrl(url);
  if (!id) throw new Error("WU PWS id not found");
  const text = await getText(
    `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(id)}&format=json&units=m&numericPrecision=decimal&apiKey=${wuApiKey()}`,
    { Accept: "application/json" },
    8_000,
  );
  const obs = (JSON.parse(text) as WuPwsResponse).observations?.[0];
  const date = obs?.obsTimeUtc ? new Date(obs.obsTimeUtc) : null;
  return {
    name: obs?.neighborhood?.replace(/\s+/g, " ").trim() || null,
    tempC: toNum(obs?.metric?.temp),
    obsTimeIso: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

// ---- HKO regional portal ------------------------------------------------

async function fetchHkoPortal(): Promise<Hit> {
  const row = await fetchRow("latest_1min_temperature.csv");
  const tempC = row.values[0];
  return {
    name: "Hong Kong Observatory",
    tempC: Number.isFinite(tempC) ? tempC : null,
    obsTimeIso: row.at,
  };
}

// ---- Public API ---------------------------------------------------------

function describe(url: string): { id: string; source: PwsReading["source"] } {
  const u = new URL(url);
  if (u.hostname.endsWith("hko.gov.hk")) return { id: "HKO", source: "hko" };
  if (u.hostname.replace(/^www\./, "") === "wunderground.com") {
    return { id: wuPwsIdFromUrl(url), source: "wunderground" };
  }
  return { id: u.searchParams.get("id") ?? "", source: "awekas" };
}

async function fetchOne(url: string): Promise<PwsReading> {
  const { id, source } = describe(url);
  const base = { id, source, url, name: null, tempC: null, obsTimeIso: null };
  try {
    const hit =
      source === "hko"
        ? await fetchHkoPortal()
        : source === "wunderground"
          ? await fetchWu(url)
          : await fetchAwekas(url);
    return hit.tempC == null
      ? { ...base, ...hit, ok: false, error: "temperature missing" }
      : { ...base, ...hit, ok: true };
  } catch (error) {
    return {
      ...base,
      ok: false,
      error: error instanceof Error ? error.message : "PWS fetch failed",
    };
  }
}

export function pwsFailedPayload(error: unknown): PwsPayload {
  return {
    stations: [],
    fetchedAt: new Date().toISOString(),
    stale: false,
    error: error instanceof Error ? error.message : "PWS fetch failed",
  };
}

export async function fetchPws(
  icao: string,
  opts: { fresh?: boolean } = {},
): Promise<PwsPayload> {
  const urls = pwsUrlsFor(icao);
  if (urls.length === 0) {
    return { stations: [], fetchedAt: new Date().toISOString(), stale: false };
  }
  const key = `pws:${icao}`;
  const hit = cacheGet<PwsPayload>(key, PWS_TTL_MS);
  if (hit?.fresh && !opts.fresh) return hit.value;

  const stations = await Promise.all(urls.map(fetchOne));
  // Every source failed: serve the last good snapshot rather than blanks.
  if (!stations.some((s) => s.ok) && hit) {
    return { ...hit.value, stale: true, error: stations[0]?.error };
  }
  const payload: PwsPayload = {
    stations,
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
  cacheSet(key, payload);
  return payload;
}
