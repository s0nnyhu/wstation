# WStation

Dark, single-page weather terminal for Polymarket **daily highest-temperature** markets. It covers European, Asian, and American **airport** resolution stations (never city-center coordinates), compares Open-Meteo models, applies an editable empirical bias table, and shows a side-by-side **Weather Underground + METAR** observation pair plus today’s running high.

Not financial advice. Always verify the market’s station, units, and rules.

## Stations

### Europe (`region: "europe"`) — default °C

| ICAO | Station | Timezone | Primary model |
|------|---------|----------|---------------|
| EHAM | Amsterdam Schiphol | Europe/Amsterdam | `icon_seamless` |
| LFPB | Paris Le Bourget | Europe/Paris | `icon_seamless` |
| EDDM | Munich | Europe/Berlin | `icon_seamless` (short-range `icon_d2`) |
| EGLC | London City | Europe/London | `ukmo_seamless` |
| LTAC | Ankara Esenboğa | Europe/Istanbul | `gem_seamless` |
| LIMC | Milan Malpensa | Europe/Rome | `icon_seamless` |
| EFHK | Helsinki-Vantaa | Europe/Helsinki | `knmi_seamless` |
| EPWA | Warsaw Chopin | Europe/Warsaw | `icon_seamless` |

### Asia (`region: "asia"`) — default °C

| ICAO | Station | Timezone | Primary model |
|------|---------|----------|---------------|
| ZSPD | Shanghai Pudong | Asia/Shanghai | `ukmo_seamless` |
| ZGSZ | Shenzhen Bao'an | Asia/Shanghai | `ecmwf_aifs025_single` |

Asia stays in °C. Bias table is NOAA WRH / Synoptic daily max vs Open-Meteo Previous Runs H−0 (2024-01-01 → 2026-09-15). AIFS at Shenzhen has a shorter archive (~2025). JMA Seamless is MSM at Shanghai and GSM at Shenzhen.

### America (`region: "america"`) — default °F

| ICAO | Station | Timezone | Primary models |
|------|---------|----------|----------------|
| KHOU | Houston Hobby | America/Chicago | `gfs_hrrr`, `gfs_seamless` |
| KDAL | Dallas Love Field | America/Chicago | `gfs_hrrr`, `gfs_seamless` |
| KMIA | Miami | America/New_York | `gfs_hrrr`, `gfs_seamless` |
| KAUS | Austin | America/Chicago | `gfs_hrrr`, `gem_seamless`, `gfs_seamless` |
| KLGA | New York LaGuardia | America/New_York | `gfs_hrrr`, `gfs_seamless` |
| KSEA | Seattle-Tacoma | America/Los_Angeles | `gem_hrdps_continental`, `gem_seamless` |

Europe and Asia stay in °C (including EGLC). America defaults to °F. Unit toggle is available on every station. US biases in `data/bias.json` are annual °F means converted to °C internally. HRRR/HRDPS rows use the seamless bias as a labeled proxy.

Compare-all: Europe keeps the existing EU set. America uses `gfs_hrrr,gfs_seamless,gem_seamless,gem_hrdps_continental,icon_seamless,ecmwf_ifs025,ukmo_seamless`. Asia uses `ukmo_seamless,icon_seamless,ecmwf_ifs025,ecmwf_aifs025_single,gfs_seamless,jma_seamless,cma_grapes_global,gem_seamless`.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Query params: `?s=EHAM&d=today`, `?s=ZSPD&d=today`, `?s=KHOU&d=today`, or `?s=KLGA&d=tomorrow&all=1`.

```bash
npm run build
npm start
npm test        # vitest: bias lookup, bucket parsing, consensus dedupe, METAR parsing
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPEN_METEO_BASE_URL` | `https://api.open-meteo.com` | Forecast host |
| `OPEN_METEO_API_KEY` | unset | Sent as `apikey` if you use the commercial API |
| `METAR_BASE_URL` | `https://aviationweather.gov/api/data/metar` | METAR JSON endpoint |
| `SYNOPTIC_TOKEN` | unset | Optional. Synoptic Data token (free tier) — reproduces the NOAA timeseries resolution feed exactly (5-minute ASOS obs). Without it the "Resolution high" is a lower bound from METAR body integers. |
| `WU_API_KEY` | public web key | Optional. weather.com key for the WU observation panel (daily + hourly + current). App still runs without it (METAR-only fallback). |

No keys are required for the public Open-Meteo, aviationweather.gov and Polymarket Gamma APIs.

## Data sources

1. **Open-Meteo Forecast API** `GET /v1/forecast`
   - Airport lat/lon from `src/config/stations.ts`
   - `daily=temperature_2m_max,temperature_2m_min`
   - `hourly=temperature_2m,precipitation_probability,cloud_cover,weather_code,precipitation,rain,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation,relative_humidity_2m` (`wind_speed_unit=ms`)
   - Drivers band uses the **primary** model only (even in Compare all) — cloud / precip / wind / shortwave around the peak window. Not bias-corrected.
   - `models=<comma-separated Open-Meteo IDs>`
   - `timezone=<station tz>`
2. **Weather Underground** (Polymarket **resolution proxy**) via weather.com, same airport ICAO as the market (EGLC≠EGLL, LFPB≠LFPG, KHOU≠IAH). Server-only. URLs in `src/lib/wu.ts`:
   - Daily 5-day: `GET https://api.weather.com/v3/wx/forecast/daily/5day?icaoCode={ICAO}&units=m&…`
   - Hourly 2-day: `GET https://api.weather.com/v3/wx/forecast/hourly/2day?icaoCode={ICAO}&units=m&…`
   - Current: `GET https://api.weather.com/v1/location/{ICAO}:9:{CC}/observations/current.json?units=m&…`
   - Not a consensus/model vote. Bias correction is **not** applied. If weather.com is blocked, the WU card shows “WU unavailable” and METAR still renders — temperatures are never invented.
3. **METAR** via [aviationweather.gov Data API](https://connect.aviationweather.gov/data/api/) — aviation cross-check: latest temp, dewpoint, wind/gust (kt), sky, humidity, altimeter, raw string, today’s observation strip, and two running highs for the market local day:
   - **Running high** — physical max, tenths from the `T` group when present.
   - **Resolution high** — max of the *integer* body temperatures, converted and rounded to the market unit. This is how the resolution page works: Polymarket resolves on the NOAA WRH timeseries (`weather.gov/wrh/timeseries?site=<icao>`), which renders `Math.round(air_temp)` from Synoptic data; for US ASOS sites that feed contains 5-minute observations in **integer °C**, so the true resolution value can exceed the hourly METAR tenths max (e.g. a 5-minute 17 °C → 63 °F while the :53 METAR reads 16.1 °C → 61 °F). Set `SYNOPTIC_TOKEN` to fetch that exact feed; otherwise the METAR-body value is a lower bound.
4. **Polymarket Gamma API** `GET https://gamma-api.polymarket.com/events?slug=highest-temperature-in-<city>-on-<month>-<d>-<yyyy>` — real bucket ranges (US markets are 2 °F ranges, European markets 1 °C), Yes price, bid/ask, and the resolution source parsed from the event description. No key required. When the event is missing, the trade helper falls back to the regional bucket convention and says so.

Consensus is the median of the bias-corrected default models with **one vote per model family** (`gfs_*`, `icon_*`, `ukmo_*`, …): an Open-Meteo "seamless" model already uses its centre's high-resolution run for the first ~48 h, so `gfs_seamless` and `gfs_hrrr` (or `icon_seamless` and `icon_d2`) are the same series on the market day and must not be counted twice. The voting ids are shown under the consensus.

The Polymarket panel also shows an **approximate model probability** per bucket: Normal(target, σ) with σ = MAE·√(π/2) where MAE is the raw-forecast MAE of the primary for the active season. It is not calibrated on Polymarket outcomes and the raw MAE overstates the corrected error — treat it as an order of magnitude, not an edge.

Forecasts are cached ~12 minutes, METARs ~2 minutes, Polymarket ~1 minute and Synoptic ~2 minutes on the Next.js server. Secondary sources (WU, Husky, Polymarket, Synoptic) have an 8 s hard budget so a slow upstream cannot block the render. The client auto-refreshes every 60 s while the tab is visible (toggle in the toolbar). On `429` / 5xx / network failure the API serves stale cache (up to 2 hours) and the UI shows a stale timestamp. Clients should hit `/api/station/[icao]`, not Open-Meteo directly.

## Config you can edit

- `src/config/stations.ts` — coordinates, default models, units, notes
- `data/biases.seasonal.json` — seasonal (and monthly) ASOS residuals for every model with a sample, per station. `getBias({icao, model, dateLocal})` prefers season n≥20, then annual n≥20, else 0 + “no bias sample”
- `data/biases.seasonal.primaries.json` — subset of the above (primary models only), kept for reference, not loaded
- `data/bias.json` — older annual table, kept for reference only (not used for correction)
- `data/backtest_summary.json` — optional hit-rates. **Leave empty unless you have real numbers.** The UI will not invent accuracy percentages.

Correction: `corrected = raw − bias`. Europe biases are °C, America °F. Season follows the market local date (DJF/MAM/JJA/SON). Force a season with `?season=JJA`; monthly grain with `?grain=month`.

## Open-Meteo attribution & licence

Weather data by [Open-Meteo.com](https://open-meteo.com/). The public `api.open-meteo.com` endpoint is for **non-commercial** use and is rate-limited. Commercial products need a [paid Open-Meteo API](https://open-meteo.com/en/pricing) (`customer-api.open-meteo.com` + `OPEN_METEO_API_KEY`).

## Out of scope (v1)

Auth, payments, Telegram, live order placement, and HuskyWeather PRO/passport features.
