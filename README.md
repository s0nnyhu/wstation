# WStation

Dark, single-page weather terminal for Polymarket **daily highest-temperature** markets. It covers European, Asian, and American **airport** resolution stations (never city-center coordinates), compares Open-Meteo models, gives a **calibrated probability per 1 °C outcome** for the four stations analysed by the weather-analysis pipeline (EDDM, LFPB, EGLC, EHAM), and shows a side-by-side **Weather Underground + METAR** observation pair plus today’s running high.

Not financial advice. Always verify the market’s station, units, and rules.

## Stations

### Europe (`region: "europe"`) — default °C

| ICAO | Station | Timezone | Models |
|------|---------|----------|--------|
| EHAM | Amsterdam Schiphol | Europe/Amsterdam | calibrated ensemble (14 native models) |
| LFPB | Paris Le Bourget | Europe/Paris | calibrated ensemble (13 native models) |
| EDDM | Munich | Europe/Berlin | calibrated ensemble (12 native models) |
| EGLC | London City | Europe/London | calibrated ensemble (14 native models) |
| LTAC | Ankara Esenboğa | Europe/Istanbul | `gem_seamless` |
| LIMC | Milan Malpensa | Europe/Rome | `icon_seamless` |
| EFHK | Helsinki-Vantaa | Europe/Helsinki | `knmi_seamless` |
| EPWA | Warsaw Chopin | Europe/Warsaw | `icon_seamless` |

### Asia (`region: "asia"`) — default °C

| ICAO | Station | Timezone | Primary model |
|------|---------|----------|---------------|
| ZSPD | Shanghai Pudong | Asia/Shanghai | `ukmo_seamless` |
| ZGSZ | Shenzhen Bao'an | Asia/Shanghai | `ecmwf_aifs025_single` |
| ZHHH | Wuhan Tianhe | Asia/Shanghai | `icon_seamless` |
| ZUUU | Chengdu Shuangliu | Asia/Shanghai | `ecmwf_aifs025_single` |
| RJTT | Tokyo Haneda | Asia/Tokyo | `gfs_seamless` |

Asia stays in °C. JMA Seamless is MSM at Shanghai and Tokyo, GSM at Shenzhen / Wuhan / Chengdu.

### America (`region: "america"`) — default °F

| ICAO | Station | Timezone | Primary models |
|------|---------|----------|----------------|
| KHOU | Houston Hobby | America/Chicago | `gfs_hrrr`, `gfs_seamless` |
| KDAL | Dallas Love Field | America/Chicago | `gfs_hrrr`, `gfs_seamless` |
| KMIA | Miami | America/New_York | `gfs_hrrr`, `gfs_seamless` |
| KAUS | Austin | America/Chicago | `gfs_hrrr`, `gem_seamless`, `gfs_seamless` |
| KLGA | New York LaGuardia | America/New_York | `gfs_hrrr`, `gfs_seamless` |
| KSEA | Seattle-Tacoma | America/Los_Angeles | `gem_hrdps_continental`, `gem_seamless` |

Europe and Asia stay in °C (including EGLC). America defaults to °F. Unit toggle is available on every station.

Compare-all (stations without a calibrated ensemble): Europe uses `icon_seamless,ukmo_seamless,meteofrance_seamless,gem_seamless,knmi_seamless,ecmwf_ifs025,gfs_seamless`. America uses `gfs_hrrr,gfs_seamless,gem_seamless,gem_hrdps_continental,icon_seamless,ecmwf_ifs025,ukmo_seamless`. Asia uses `ukmo_seamless,icon_seamless,ecmwf_ifs025,ecmwf_aifs025_single,gfs_seamless,jma_seamless,cma_grapes_global,gem_seamless`.

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
npm test        # vitest: ensemble parity with the pipeline, bucket parsing, consensus dedupe, METAR parsing
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPEN_METEO_BASE_URL` | `https://api.open-meteo.com` | Forecast host |
| `OPEN_METEO_API_KEY` | unset | Sent as `apikey` if you use the commercial API |
| `METAR_BASE_URL` | `https://aviationweather.gov/api/data/metar` | METAR JSON endpoint |
| `SYNOPTIC_TOKEN` | unset | Optional. Synoptic Data token (free tier) — reproduces the NOAA timeseries resolution feed exactly (5-minute ASOS obs). Without it the "Resolution high" is a lower bound from METAR body integers. |
| `TMAX_LIVE_BIAS_URL` | `http://34.245.85.250:5006/biais.json` | Recipe published by the weather-analysis pipeline (VPS) |
| `WU_API_KEY` | public web key | Optional. weather.com key for the WU observation panel (daily + hourly + current). App still runs without it (METAR-only fallback). |

No keys are required for the public Open-Meteo, aviationweather.gov and Polymarket Gamma APIs.

## Data sources

1. **Open-Meteo Forecast API** `GET /v1/forecast`
   - Airport lat/lon from `src/config/stations.ts`
   - `daily=temperature_2m_max,temperature_2m_min`
   - `hourly=temperature_2m,precipitation_probability,cloud_cover,weather_code,precipitation,rain,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation,relative_humidity_2m` (`wind_speed_unit=ms`)
   - Drivers band uses the station's **reference** model only (`primary` in the config; ICON-D2 for the ensemble stations) — cloud / precip / wind / shortwave around the peak window.
   - Ensemble stations make a second request, `hourly=temperature_2m` for every native model with `past_days=1&forecast_days=4&timeformat=unixtime`, exactly like the pipeline.
   - `models=<comma-separated Open-Meteo IDs>`
   - `timezone=<station tz>`
2. **Weather Underground** (Polymarket **resolution proxy**) via weather.com, same airport ICAO as the market (EGLC≠EGLL, LFPB≠LFPG, KHOU≠IAH). Server-only. URLs in `src/lib/wu.ts`:
   - Daily 5-day: `GET https://api.weather.com/v3/wx/forecast/daily/5day?icaoCode={ICAO}&units=m&…`
   - Hourly 2-day: `GET https://api.weather.com/v3/wx/forecast/hourly/2day?icaoCode={ICAO}&units=m&…`
   - Current: `GET https://api.weather.com/v1/location/{ICAO}:9:{CC}/observations/current.json?units=m&…`
   - Not a model vote and never corrected. If weather.com is blocked, the WU card shows “WU unavailable” and METAR still renders — temperatures are never invented.
3. **METAR** via [aviationweather.gov Data API](https://connect.aviationweather.gov/data/api/) — aviation cross-check: latest temp, dewpoint, wind/gust (kt), sky, humidity, altimeter, raw string, today’s observation strip, and two running highs for the market local day:
   - **Running high** — physical max, tenths from the `T` group when present.
   - **Resolution high** — max of the *integer* body temperatures, converted and rounded to the market unit. This is how the resolution page works: Polymarket resolves on the NOAA WRH timeseries (`weather.gov/wrh/timeseries?site=<icao>`), which renders `Math.round(air_temp)` from Synoptic data; for US ASOS sites that feed contains 5-minute observations in **integer °C**, so the true resolution value can exceed the hourly METAR tenths max (e.g. a 5-minute 17 °C → 63 °F while the :53 METAR reads 16.1 °C → 61 °F). Set `SYNOPTIC_TOKEN` to fetch that exact feed; otherwise the METAR-body value is a lower bound.
4. **Polymarket Gamma API** `GET https://gamma-api.polymarket.com/events?slug=highest-temperature-in-<city>-on-<month>-<d>-<yyyy>` — real bucket ranges (US markets are 2 °F ranges, European markets 1 °C), Yes price, bid/ask, and the resolution source parsed from the event description. No key required. When the event is missing, the trade helper falls back to the regional bucket convention and says so.

## Calibrated ensemble (EDDM, LFPB, EGLC, EHAM)

These four stations follow the weather-analysis study (one year of METAR, 13 models, issue-time leads, walk-forward
backtest). No single model is significantly better than the runner-up, and the bias-corrected blend beats the best
single model (blend MAE 0.68 / 0.74 / 0.85 °C for today 08:00 / day ahead / two days ahead vs 0.89 / 1.06 / 1.45 °C
for the best raw model, Aug–Oct 2026 out of sample), so there is **no primary model** any more: the headline is the
most likely 1 °C outcome of the calibrated distribution and the blend behind it.

Every page load:

1. **Lead** — today: the last of 08:00 / 10:30 / 13:30 local that has passed (`J0_08h`, `J0_10h30`, `J0_13h30`);
   tomorrow: `J1`.
2. **Raw max per model** — hourly max of `temperature_2m` over the local day's hours at or after the run's
   initialisation (Open-Meteo `meta.json`; if older than 36 h, the latest 00Z/12Z run given the model's
   publication delay). Every one of those hours must be present.
3. **Recipe** — `biais.json` from the VPS (refreshed at 08:00 / 10:30 / 13:30 local, refit once a day on data up to
   yesterday): per model the walk-forward bias (mean of past errors forecast − METAR daily max, cumulative or
   30-day rolling depending on the lead), its past MSE, the same-family pairs to de-duplicate, the blend method
   (mean / top-k / 1/MSE weights) and the NGR distribution `N(a + b·blend, c + d·spread²)`. Just after midnight,
   today's J0 recipe is not out yet and the previous day's one (≤ 2 days old) is used and flagged.
4. **Blend** — corrected = raw − bias, one model per redundant family, ranked by past MSE, combined as published.
5. **Distribution** — P(METAR max = k °C) for each integer k (rounding variance removed), outcomes below today's
   METAR resolution high excluded, 0.5 % floor on neighbouring outcomes. Shown in the hero, the trade helper and,
   per Polymarket bucket, in the Polymarket panel.

`src/lib/ensemble.ts` mirrors `weather-analysis/recipe.py`; `ensemble.test.ts` checks it reproduces the pipeline's
own blend and probabilities on a real `biais.json` extract. If the recipe is unreachable or older than 36 h, the
page shows the raw models and their median, with a warning — no correction and no probability is invented.

## Other stations

No calibrated correction: the headline is the **median of the raw** default models with one vote per model family
(`gfs_*`, `icon_*`, `ukmo_*`, …) — an Open-Meteo "seamless" model already uses its centre's high-resolution run for
the first ~48 h, so `gfs_seamless` and `gfs_hrrr` are the same series on the market day and vote once. No
probability is shown in the Polymarket panel.

Forecasts are cached ~12 minutes, METARs ~2 minutes, Polymarket ~1 minute and Synoptic ~2 minutes on the Next.js server. Secondary sources (WU, Husky, Polymarket, Synoptic) have an 8 s hard budget so a slow upstream cannot block the render. The client auto-refreshes every 60 s while the tab is visible (toggle in the toolbar). On `429` / 5xx / network failure the API serves stale cache (up to 2 hours) and the UI shows a stale timestamp. Clients should hit `/api/station/[icao]`, not Open-Meteo directly.

## Config you can edit

- `src/config/stations.ts` — coordinates, default models, units, notes
- `src/config/stations.ts` `ensemble.models` — native models of the four calibrated stations (must match the
  pipeline's configuration)

## Open-Meteo attribution & licence

Weather data by [Open-Meteo.com](https://open-meteo.com/). The public `api.open-meteo.com` endpoint is for **non-commercial** use and is rate-limited. Commercial products need a [paid Open-Meteo API](https://open-meteo.com/en/pricing) (`customer-api.open-meteo.com` + `OPEN_METEO_API_KEY`).

## Out of scope (v1)

Auth, payments, Telegram, live order placement, and HuskyWeather PRO/passport features.
