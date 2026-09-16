#!/usr/bin/env python3
"""Bias study vs NOAA WRH daily max for ZSPD, ZGSZ, ZHHH, ZUUU, RJTT.

Truth: max(Math.round(°C)) of Synoptic/WRH air_temp on the local calendar day.
Forecasts: Open-Meteo Previous Runs (h24 = previous_day1, h0 = latest run).
Does not modify the dashboard.
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STUDIES = ROOT / "data" / "studies"
START = date(2024, 1, 1)
END = date(2026, 9, 15)
UA = "WStation/0.1 Asia archive study"
WRH_REFERER = "https://www.weather.gov/wrh/timeseries"
LEADS = {"h24": "temperature_2m_previous_day1", "h0": "temperature_2m"}
SEASON_MONTHS = {
    "DJF": {12, 1, 2},
    "MAM": {3, 4, 5},
    "JJA": {6, 7, 8},
    "SON": {9, 10, 11},
}
YEARS = (2024, 2025, 2026)
CORE_MODELS = [
    "icon_seamless",
    "ukmo_seamless",
    "meteofrance_seamless",
    "gem_seamless",
    "ecmwf_ifs025",
    "ecmwf_aifs025_single",
    "gfs_seamless",
    "cma_grapes_global",
    "jma_seamless",
    "knmi_seamless",
]
MIN_OBS = 16
MIN_N = 20
MIN_HOURS = 20


@dataclass(frozen=True)
class StationSpec:
    icao: str
    name: str
    lat: float
    lon: float
    tz: str
    extras: tuple[str, ...] = ()

    @property
    def models(self) -> list[str]:
        return list(dict.fromkeys([*CORE_MODELS, *self.extras]))


STATIONS = [
    StationSpec("ZSPD", "Shanghai Pudong", 31.1434, 121.8052, "Asia/Shanghai",
                ("jma_msm", "jma_gsm", "icon_global")),
    StationSpec("ZGSZ", "Shenzhen Bao'an", 22.6393, 113.8107, "Asia/Shanghai",
                ("jma_gsm",)),
    StationSpec("ZHHH", "Wuhan Tianhe", 30.7838, 114.2081, "Asia/Shanghai",
                ("jma_gsm",)),
    StationSpec("ZUUU", "Chengdu Shuangliu", 30.5785, 103.9471, "Asia/Shanghai",
                ("jma_gsm",)),
    StationSpec("RJTT", "Tokyo Haneda", 35.5523, 139.7798, "Asia/Tokyo",
                ("jma_msm", "jma_gsm")),
]


def js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def season_of(d: date) -> str:
    m = d.month
    for name, months in SEASON_MONTHS.items():
        if m in months:
            return name
    return "SON"


def month_key(d: date) -> str:
    return f"{d.month:02d}"


def chunk_dates(start: date, end: date, days: int) -> list[tuple[date, date]]:
    chunks = []
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=days - 1), end)
        chunks.append((cur, nxt))
        cur = nxt + timedelta(days=1)
    return chunks


def http_json(url: str, headers: dict[str, str], retries: int = 4) -> dict:
    last: Exception | None = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                raw = res.read()
            if not raw.strip():
                raise ValueError("empty body")
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            body = e.read()[:300] if e.fp else b""
            last = e
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"HTTP {e.code} {body!r}") from e
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(str(last))


def wrh_token() -> str:
    env = os.environ.get("SYNOPTIC_TOKEN", "").strip()
    if env:
        return env
    text = urllib.request.urlopen(
        urllib.request.Request(
            "https://www.weather.gov/source/wrh/apiKey.js",
            headers={"User-Agent": UA, "Referer": f"{WRH_REFERER}?site=zspd"},
        ),
        timeout=30,
    ).read().decode("utf-8")
    m = re.search(r"mesoToken\s*=\s*'([^']+)'", text)
    if not m:
        raise RuntimeError("Could not parse WRH Synoptic token")
    return m.group(1)


def fetch_synoptic(token: str, icao: str, start: date, end: date) -> list[tuple[datetime, float]]:
    params = {
        "STID": icao,
        "showemptystations": "1",
        "units": "temp|C",
        "start": start.strftime("%Y%m%d0000"),
        "end": end.strftime("%Y%m%d2359"),
        "complete": "1",
        "token": token,
        "obtimezone": "utc",
        "vars": "air_temp",
    }
    url = "https://api.synopticdata.com/v2/stations/timeseries?" + urllib.parse.urlencode(params)
    data = http_json(
        url,
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": f"{WRH_REFERER}?site={icao.lower()}",
            "Origin": "https://www.weather.gov",
            "Accept": "application/json",
        },
    )
    summary = data.get("SUMMARY") or {}
    if summary.get("RESPONSE_CODE") != 1:
        raise RuntimeError(f"Synoptic: {summary.get('RESPONSE_MESSAGE')}")
    obs = ((data.get("STATION") or [{}])[0].get("OBSERVATIONS")) or {}
    rows = []
    for t, c in zip(obs.get("date_time") or [], obs.get("air_temp_set_1") or []):
        if c is None or t is None:
            continue
        try:
            val = float(c)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(val):
            continue
        ts = datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(timezone.utc)
        rows.append((ts, val))
    return rows


def fetch_iem(icao: str, start: date, end: date) -> list[tuple[datetime, float]]:
    params = {
        "station": icao,
        "data": "tmpc",
        "year1": str(start.year),
        "month1": str(start.month),
        "day1": str(start.day),
        "year2": str(end.year),
        "month2": str(end.month),
        "day2": str(end.day),
        "tz": "Etc/UTC",
        "format": "onlycomma",
        "latlon": "no",
        "elev": "no",
        "missing": "empty",
        "trace": "T",
        "direct": "no",
    }
    url = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as res:
        text = res.read().decode("utf-8", errors="replace")
    rows = []
    for line in text.splitlines()[1:]:
        parts = line.split(",")
        if len(parts) < 3 or not parts[2].strip():
            continue
        ts = datetime.strptime(parts[1].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        rows.append((ts, float(parts[2])))
    return rows


def load_obs(st: StationSpec, token: str) -> list[tuple[datetime, float]]:
    cache = STUDIES / st.icao.lower() / "cache"
    path = cache / "synoptic_obs.csv"
    if path.exists():
        rows = []
        with path.open() as f:
            for rec in csv.DictReader(f):
                ts = datetime.fromisoformat(rec["utc"])
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                rows.append((ts, float(rec["tmpc"])))
        print(f"  obs cache n={len(rows)}")
        return rows
    utc_start, utc_end = START - timedelta(days=1), END + timedelta(days=1)
    all_rows: list[tuple[datetime, float]] = []
    chunks = chunk_dates(utc_start, utc_end, 90)
    for i, (a, b) in enumerate(chunks, 1):
        print(f"  synoptic {a} → {b} ({i}/{len(chunks)})", flush=True)
        try:
            chunk = fetch_synoptic(token, st.icao, a, b)
        except Exception as e:
            print(f"    synoptic failed ({e}); IEM", flush=True)
            chunk = fetch_iem(st.icao, a, b)
        print(f"    n={len(chunk)}", flush=True)
        all_rows.extend(chunk)
        time.sleep(0.3)
    by_ts = {ts.isoformat(): (ts, val) for ts, val in all_rows}
    rows = [by_ts[k] for k in sorted(by_ts)]
    cache.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["utc", "tmpc"])
        for ts, val in rows:
            w.writerow([ts.astimezone(timezone.utc).isoformat(), f"{val:.2f}"])
    print(f"  wrote obs n={len(rows)}")
    return rows


def daily_wrh_max(obs: list[tuple[datetime, float]], tz: ZoneInfo) -> dict[str, dict]:
    buckets: dict[str, list[tuple[datetime, float, int]]] = defaultdict(list)
    for ts, val in obs:
        local = ts.astimezone(tz)
        buckets[local.date().isoformat()].append((ts, val, js_round(val)))
    out = {}
    for key, items in buckets.items():
        if len(items) < MIN_OBS:
            continue
        best = max(items, key=lambda r: (r[2], r[1], r[0].isoformat()))
        out[key] = {"n": len(items), "max_c": best[1], "wrh_max": best[2]}
    return {k: v for k, v in out.items() if START.isoformat() <= k <= END.isoformat()}


def parse_om_daily(payload: dict, models: list[str]) -> list[dict]:
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    series: dict[tuple[str, str], list] = {}
    for lead, base in LEADS.items():
        for model in models:
            key = f"{base}_{model}"
            if key in hourly:
                series[(model, lead)] = hourly[key]
            elif len(models) == 1 and base in hourly:
                series[(model, lead)] = hourly[base]
    daily: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for i, t in enumerate(times):
        day = t[:10]
        for (model, lead), vals in series.items():
            if i >= len(vals) or vals[i] is None:
                continue
            try:
                v = float(vals[i])
            except (TypeError, ValueError):
                continue
            if math.isfinite(v):
                daily[(day, model, lead)].append(v)
    return [
        {"date": day, "model": model, "lead": lead, "tmax": max(vals), "n_hours": len(vals)}
        for (day, model, lead), vals in daily.items()
        if vals
    ]


def load_forecasts(st: StationSpec) -> list[dict]:
    cache = STUDIES / st.icao.lower() / "cache"
    path = cache / "om_daily.csv"
    if path.exists():
        with path.open() as f:
            rows = list(csv.DictReader(f))
        for r in rows:
            r["tmax"] = float(r["tmax"])
            r["n_hours"] = int(r["n_hours"])
        print(f"  forecast cache n={len(rows)}")
        return rows
    rows: list[dict] = []
    chunks = chunk_dates(START, END, 90)
    # Two model batches keep the URL / payload smaller and isolate a bad model.
    batches = [st.models[:6], st.models[6:]]
    batches = [b for b in batches if b]
    for i, (a, b) in enumerate(chunks, 1):
        for batch in batches:
            print(f"  om previous-runs {a} → {b} ({i}/{len(chunks)}) models={len(batch)}", flush=True)
            qs = urllib.parse.urlencode(
                {
                    "latitude": st.lat,
                    "longitude": st.lon,
                    "hourly": ",".join(LEADS.values()),
                    "models": ",".join(batch),
                    "timezone": st.tz,
                    "start_date": a.isoformat(),
                    "end_date": b.isoformat(),
                }
            )
            url = "https://previous-runs-api.open-meteo.com/v1/forecast?" + qs
            payload = http_json(url, {"User-Agent": UA, "Accept": "application/json"})
            if payload.get("error"):
                raise RuntimeError(payload.get("reason") or "Open-Meteo error")
            part = parse_om_daily(payload, batch)
            print(f"    daily rows={len(part)}", flush=True)
            rows.extend(part)
            time.sleep(0.4)
    cache.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "model", "lead", "tmax", "n_hours"])
        w.writeheader()
        w.writerows(rows)
    print(f"  wrote forecasts n={len(rows)}")
    return rows


def summarize(pairs: list[tuple[float, int]]) -> dict | None:
    if len(pairs) < MIN_N:
        return None
    errs = [f - o for f, o in pairs]
    bias = mean(errs)
    mae = mean(abs(e) for e in errs)
    mae_corr = mean(abs(e - bias) for e in errs)
    hit_raw = mean(1.0 if js_round(f) == o else 0.0 for f, o in pairs)
    hit_corr = mean(1.0 if js_round(f - bias) == o else 0.0 for f, o in pairs)
    within05 = mean(1.0 if abs(e - bias) <= 0.5 else 0.0 for e in errs)
    return {
        "n": len(pairs),
        "bias": round(bias, 3),
        "mae": round(mae, 3),
        "mae_corrected": round(mae_corr, 3),
        "hit_raw": round(hit_raw, 3),
        "hit_corrected": round(hit_corr, 3),
        "within_0_5_corrected": round(within05, 3),
    }


def group_stats(joined: list[dict]) -> dict:
    by: dict[tuple[str, str, str], list[tuple[float, int]]] = defaultdict(list)
    for r in joined:
        d = date.fromisoformat(r["date"])
        pair = (r["tmax"], r["wrh_max"])
        by[(r["model"], r["lead"], "annual")].append(pair)
        by[(r["model"], r["lead"], f"year:{d.year}")].append(pair)
        by[(r["model"], r["lead"], f"season:{season_of(d)}")].append(pair)
        by[(r["model"], r["lead"], f"month:{month_key(d)}")].append(pair)
    models: dict[str, dict] = {}
    for (model, lead, grain), pairs in by.items():
        stats = summarize(pairs)
        if not stats:
            continue
        block = models.setdefault(model, {}).setdefault(lead, {})
        if grain == "annual":
            block["annual"] = stats
        elif grain.startswith("year:"):
            block.setdefault("years", {})[grain.split(":", 1)[1]] = stats
        elif grain.startswith("season:"):
            block.setdefault("seasons", {})[grain.split(":", 1)[1]] = stats
        else:
            block.setdefault("months", {})[grain.split(":", 1)[1]] = stats
    return models


def rank_table(models: dict, lead: str, grain: str = "annual") -> list[dict]:
    rows = []
    for model, leads in models.items():
        block = leads.get(lead) or {}
        if grain == "annual":
            stats = block.get("annual")
        elif grain.startswith("year:"):
            stats = (block.get("years") or {}).get(grain.split(":", 1)[1])
        else:
            stats = (block.get("seasons") or {}).get(grain)
        if not stats:
            continue
        rows.append({"model": model, **stats})
    rows.sort(key=lambda r: (r["mae_corrected"], -r["hit_corrected"], r["mae"]))
    return rows


def pick(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    best = rows[0]
    backups = [r for r in rows[1:] if r["model"].split("_")[0] != best["model"].split("_")[0]]
    return {
        "primary": best["model"],
        "primary_mae_corrected": best["mae_corrected"],
        "primary_bias": best["bias"],
        "primary_hit_corrected": best["hit_corrected"],
        "backup": backups[0]["model"] if backups else None,
        "backup_mae_corrected": backups[0]["mae_corrected"] if backups else None,
    }


def dump_rank(title: str, rows: list[dict]) -> None:
    print(f"\n{title}")
    print(f"{'model':<32} {'n':>5} {'bias':>7} {'MAE':>6} {'MAEΔ':>6} {'hitΔ':>6} {'≤0.5Δ':>6}")
    for i, r in enumerate(rows):
        mark = "*" if i == 0 else " "
        print(
            f"{mark}{r['model']:<31} {r['n']:5d} {r['bias']:7.3f} {r['mae']:6.3f} "
            f"{r['mae_corrected']:6.3f} {r['hit_corrected']:6.3f} {r['within_0_5_corrected']:6.3f}"
        )


def run_station(st: StationSpec, token: str) -> dict:
    print(f"\n=== {st.icao} {st.name} ===", flush=True)
    tz = ZoneInfo(st.tz)
    obs = load_obs(st, token)
    daily_obs = daily_wrh_max(obs, tz)
    print(f"  WRH days n={len(daily_obs)}", flush=True)
    forecasts = load_forecasts(st)
    joined = []
    for r in forecasts:
        obs_row = daily_obs.get(r["date"])
        if not obs_row or r["n_hours"] < MIN_HOURS:
            continue
        joined.append(
            {
                "date": r["date"],
                "model": r["model"],
                "lead": r["lead"],
                "tmax": r["tmax"],
                "wrh_max": obs_row["wrh_max"],
                "obs_max_c": obs_row["max_c"],
                "obs_n": obs_row["n"],
            }
        )
    out = STUDIES / st.icao.lower()
    out.mkdir(parents=True, exist_ok=True)
    with (out / "daily.csv").open("w", newline="") as f:
        w = csv.DictWriter(
            f, fieldnames=["date", "model", "lead", "tmax", "wrh_max", "obs_max_c", "obs_n"]
        )
        w.writeheader()
        w.writerows(joined)
    models = group_stats(joined)
    rec = {
        "h0": {
            "lead": "h0",
            "annual": pick(rank_table(models, "h0")),
            "years": {str(y): pick(rank_table(models, "h0", f"year:{y}")) for y in YEARS},
            "seasons": {s: pick(rank_table(models, "h0", s)) for s in SEASON_MONTHS},
        },
        "h24": {
            "lead": "h24",
            "annual": pick(rank_table(models, "h24")),
            "years": {str(y): pick(rank_table(models, "h24", f"year:{y}")) for y in YEARS},
            "seasons": {s: pick(rank_table(models, "h24", s)) for s in SEASON_MONTHS},
        },
    }
    payload = {
        "station": st.icao,
        "name": st.name,
        "timezone": st.tz,
        "window": {"start": START.isoformat(), "end": END.isoformat()},
        "sample_days": len(daily_obs),
        "joined_rows": len(joined),
        "truth": "NOAA WRH / Synoptic; max(Math.round(°C)) local day",
        "forecasts": "Open-Meteo Previous Runs",
        "recommendations": rec,
        "models": models,
    }
    (out / "stats.json").write_text(json.dumps(payload, indent=2))
    dump_rank(f"{st.icao} H−0 annual (today / latest run)", rank_table(models, "h0"))
    dump_rank(f"{st.icao} H−24 annual (tomorrow / previous_day1)", rank_table(models, "h24"))
    for y in YEARS:
        dump_rank(f"{st.icao} H−0 {y}", rank_table(models, "h0", f"year:{y}"))
    print("  rec H−0 ", rec["h0"]["annual"])
    print("  rec H−24", rec["h24"]["annual"])
    return {
        "icao": st.icao,
        "name": st.name,
        "sample_days": len(daily_obs),
        "h0": rec["h0"]["annual"],
        "h24": rec["h24"]["annual"],
        "h0_rank": rank_table(models, "h0"),
        "h24_rank": rank_table(models, "h24"),
        "years_h0": {str(y): rec["h0"]["years"][str(y)] for y in YEARS},
        "years_h24": {str(y): rec["h24"]["years"][str(y)] for y in YEARS},
        "year_ranks_h0": {str(y): rank_table(models, "h0", f"year:{y}") for y in YEARS},
        "year_ranks_h24": {str(y): rank_table(models, "h24", f"year:{y}") for y in YEARS},
        "seasons_h0": rec["h0"]["seasons"],
        "seasons_h24": rec["h24"]["seasons"],
    }


def main() -> int:
    wanted = [a.upper() for a in sys.argv[1:]] or [s.icao for s in STATIONS]
    token = wrh_token()
    summary = []
    for st in STATIONS:
        if st.icao not in wanted:
            continue
        summary.append(run_station(st, token))
    path = STUDIES / "asia5_summary.json"
    path.write_text(
        json.dumps(
            {"window": {"start": START.isoformat(), "end": END.isoformat()}, "stations": summary},
            indent=2,
        )
    )
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
