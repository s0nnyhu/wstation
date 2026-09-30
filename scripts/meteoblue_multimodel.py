#!/usr/bin/env python3
"""Archive meteoblue MultiModel 3-day hourly temperatures and show them on :5004.

--loop captures each station at 08:00, 10:30 and 13:30 in that station's
timezone. A missed slot is not backfilled. One JSON per local day holds
every run. A run without --loop captures the current slot immediately.
--serve (also started by --loop) renders the latest capture at http://0.0.0.0:5004.
Each forecast day is an hour × model table, with that date's Polymarket
favorite, local METAR maximum, and resolution link.

Several models (IFS, AIFS, ICON-D2, NMM-12) are often published after 08:00
local, so their series can still be the previous run. Each model's update
time is stored with the capture.

    python3 scripts/meteoblue_multimodel.py --serve
    python3 scripts/meteoblue_multimodel.py --loop
    python3 scripts/meteoblue_multimodel.py
    python3 scripts/meteoblue_multimodel.py --show --icao LFPB
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time as dtime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PARIS = ZoneInfo("Europe/Paris")
SLOTS = (dtime(8, 0), dtime(10, 30), dtime(13, 30))
SLOT_LABELS = tuple(slot.strftime("%H:%M") for slot in SLOTS)
SLOT_GRACE = timedelta(minutes=15)
DASHBOARD_HTML = Path(__file__).with_name("meteoblue_dashboard.html")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
TIMEOUT_S = 60
RETRIES = 3
STATION_GAP_S = 0.8
HOURS = tuple(f"{hour:02d}:00" for hour in range(24))

# Airport pages resolved from meteoblue search. The slug is the multimodel path.
STATIONS: tuple[dict[str, Any], ...] = (
    {"icao": "EDDM", "city": "Munich", "timezone": "Europe/Berlin", "unit": "C", "lat": 48.3538, "lon": 11.7861, "slug": "munich-international-airport_germany_3208399"},
    {"icao": "EGLC", "city": "London", "timezone": "Europe/London", "unit": "C", "lat": 51.5053, "lon": 0.0553, "slug": "london-city-airport_united-kingdom_6296599"},
    {"icao": "LIMC", "city": "Milan", "timezone": "Europe/Rome", "unit": "C", "lat": 45.6306, "lon": 8.7281, "slug": "milano-malpensa-airport_italy_3174133"},
    {"icao": "LFPB", "city": "Paris", "timezone": "Europe/Paris", "unit": "C", "lat": 48.9694, "lon": 2.4414, "slug": "paris–le-bourget-airport_france_2988502"},
    {"icao": "LTAC", "city": "Ankara", "timezone": "Europe/Istanbul", "unit": "C", "lat": 40.1281, "lon": 32.9951, "slug": "ankara-esenboğa-international-airport_republic-of-türkiye_6299725"},
    {"icao": "EFHK", "city": "Helsinki", "timezone": "Europe/Helsinki", "unit": "C", "lat": 60.3172, "lon": 24.9633, "slug": "helsinki-airport_finland_6301511"},
    {"icao": "EPWA", "city": "Warsaw", "timezone": "Europe/Warsaw", "unit": "C", "lat": 52.1657, "lon": 20.9671, "slug": "warsaw-chopin-airport_poland_6296786"},
    {"icao": "EHAM", "city": "Amsterdam", "timezone": "Europe/Amsterdam", "unit": "C", "lat": 52.3086, "lon": 4.7639, "slug": "amsterdam-airport-schiphol_the-netherlands_6296680"},
    {"icao": "ZSPD", "city": "Shanghai", "timezone": "Asia/Shanghai", "unit": "C", "lat": 31.1434, "lon": 121.8052, "slug": "shanghai-pudong-international-airport_china_6301386"},
    {"icao": "ZGSZ", "city": "Shenzhen", "timezone": "Asia/Shanghai", "unit": "C", "lat": 22.6393, "lon": 113.8107, "slug": "shenzhen-bao'an-international-airport_china_6301365"},
    {"icao": "ZHHH", "city": "Wuhan", "timezone": "Asia/Shanghai", "unit": "C", "lat": 30.7838, "lon": 114.2081, "slug": "wuhan-tianhe-international-airport_china_6301368"},
    {"icao": "ZUUU", "city": "Chengdu", "timezone": "Asia/Shanghai", "unit": "C", "lat": 30.5785, "lon": 103.9471, "slug": "chengdu-shuangliu-international-airport_china_6301392"},
    {"icao": "RJTT", "city": "Tokyo", "timezone": "Asia/Tokyo", "unit": "C", "lat": 35.5523, "lon": 139.7798, "slug": "tokyo-international-airport_japan_6300412"},
    {"icao": "KHOU", "city": "Houston", "timezone": "America/Chicago", "unit": "F", "lat": 29.6454, "lon": -95.2789, "slug": "houston-hobby_united-states_4741989"},
    {"icao": "KDAL", "city": "Dallas", "timezone": "America/Chicago", "unit": "F", "lat": 32.8471, "lon": -96.8518, "slug": "dallas-love-field_united-states_4684922"},
    {"icao": "KMIA", "city": "Miami", "timezone": "America/New_York", "unit": "F", "lat": 25.7959, "lon": -80.287, "slug": "miami-international-airport_united-states_4164181"},
    {"icao": "KLGA", "city": "New York", "timezone": "America/New_York", "unit": "F", "lat": 40.7772, "lon": -73.8726, "slug": "laguardia-airport_united-states_5123698"},
    {"icao": "KSEA", "city": "Seattle", "timezone": "America/Los_Angeles", "unit": "F", "lat": 47.4502, "lon": -122.3088, "slug": "seattle-tacoma-international-airport_united-states_5809876"},
    {"icao": "ZBAA", "city": "Beijing", "timezone": "Asia/Shanghai", "unit": "C", "lat": 40.0801, "lon": 116.585, "slug": "beijing-capital-international-airport_china_6301354"},
    {"icao": "ZGGG", "city": "Guangzhou", "timezone": "Asia/Shanghai", "unit": "C", "lat": 23.3924, "lon": 113.299, "slug": "guangzhou-baiyun-international-airport_china_6301359"},
    {"icao": "WSSS", "city": "Singapore", "timezone": "Asia/Singapore", "unit": "C", "lat": 1.35019, "lon": 103.994, "slug": "singapore-changi-airport_singapore_1880725"},
    {"icao": "RCSS", "city": "Taipei", "timezone": "Asia/Taipei", "unit": "C", "lat": 25.0694, "lon": 121.552, "slug": "taipei-songshan-airport_taiwan_1980019"},
    {"icao": "WMKK", "city": "Kuala Lumpur", "timezone": "Asia/Kuala_Lumpur", "unit": "C", "lat": 2.74558, "lon": 101.71, "slug": "kuala-lumpur-international-airport_malaysia_6301255"},
    {"icao": "RKSI", "city": "Seoul", "timezone": "Asia/Seoul", "unit": "C", "lat": 37.4691, "lon": 126.451, "slug": "incheon-international-airport_south-korea_6300433"},
    {"icao": "RKPK", "city": "Busan", "timezone": "Asia/Seoul", "unit": "C", "lat": 35.1795, "lon": 128.938, "slug": "busan-/-gimhae-international-airport_south-korea_6300424"},
    {"icao": "KAUS", "city": "Austin", "timezone": "America/Chicago", "unit": "F", "lat": 30.18304, "lon": -97.67987, "slug": "austin-bergstrom-international-airport_united-states_4673601"},
    {"icao": "KATL", "city": "Atlanta", "timezone": "America/New_York", "unit": "F", "lat": 33.64028, "lon": -84.42694, "slug": "hartsfield-jackson-atlanta-international-airport_united-states_4199556"},
)
BY_ICAO = {row["icao"]: row for row in STATIONS}

POLYMARKET_CITY = {
    "EHAM": "amsterdam",
    "LFPB": "paris",
    "EDDM": "munich",
    "EGLC": "london",
    "LTAC": "ankara",
    "LIMC": "milan",
    "EFHK": "helsinki",
    "EPWA": "warsaw",
    "ZSPD": "shanghai",
    "ZGSZ": "shenzhen",
    "ZHHH": "wuhan",
    "ZUUU": "chengdu",
    "RJTT": "tokyo",
    "KHOU": "houston",
    "KDAL": "dallas",
    "KMIA": "miami",
    "KLGA": "nyc",
    "KSEA": "seattle",
    "ZBAA": "beijing",
    "ZGGG": "guangzhou",
    "WSSS": "singapore",
    "RCSS": "taipei",
    "WMKK": "kuala-lumpur",
    "RKSI": "seoul",
    "RKPK": "busan",
    "KAUS": "austin",
    "KATL": "atlanta",
}
POLYMARKET_MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
METAR_BASE = "https://aviationweather.gov/api/data/metar"
WU_HOURLY = "https://api.weather.com/v3/wx/forecast/hourly/15day"
WU_DAILY = "https://api.weather.com/v3/wx/forecast/daily/5day"
WU_KEY = "e1f10a1e78da46f5b10a1e78da96f525"
CONTEXT_TTL_S = 60.0
_CONTEXT_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_CONTEXT_LOCK = threading.Lock()

HREF_RE = re.compile(r'data-href="([^"]*meteogram_multimodel[^"]+)"')
LABEL_RE = re.compile(
    r'id="params_([^"]+)"[^>]*checked="checked"[^>]*/>\s*<label[^>]*>\s*([^<]+?)\s*</label>'
)
UPDATE_RE = re.compile(
    r'<td class="model-name">\s*([^<]+?)\s*</td>'
    r'(?:(?!</tr>).)*?'
    r'<td class="last-updated" title="([^"]*)">\s*([^<]+?)\s*</td>',
    re.S,
)


def now_paris() -> datetime:
    return datetime.now(PARIS)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def station_rows(icaos: list[str] | None) -> list[dict[str, Any]]:
    if not icaos:
        return list(STATIONS)
    rows = []
    for raw in icaos:
        icao = raw.strip().upper()
        row = BY_ICAO.get(icao)
        if row is None:
            known = ", ".join(BY_ICAO)
            raise SystemExit(f"unknown station {icao}. Use one of: {known}")
        rows.append(row)
    return rows


def page_url(slug: str) -> str:
    quoted = urllib.parse.quote(slug, safe="-_.")
    return f"https://www.meteoblue.com/en/weather/forecast/multimodel/{quoted}"


def http_bytes(url: str, accept: str, referer: str | None = None) -> bytes:
    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                raw = res.read()
            if not raw.strip():
                raise ValueError("empty body")
            return raw
        except urllib.error.HTTPError as exc:
            last = exc
            retryable = exc.code in (429, 500, 502, 503, 504)
            if retryable and attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception as exc:
            last = exc
            if attempt < RETRIES:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(str(last))


def chart_url(page: str, page_html: str) -> str:
    matches = [html.unescape(found) for found in HREF_RE.findall(page_html)]
    chosen = next((item for item in matches if "forecast_days=3" in item), "")
    if not chosen and matches:
        chosen = matches[0]
    if "forecast_days=3" not in chosen:
        raise RuntimeError(f"3-day chart URL missing on {page}")
    if chosen.startswith("//"):
        chosen = "https:" + chosen
    return chosen


def model_labels(page_html: str) -> dict[str, str]:
    return {code: name.strip() for code, name in LABEL_RE.findall(page_html)}


def model_updates(page_html: str) -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    for name, title, label in UPDATE_RE.findall(page_html):
        found[name.strip()] = {"updated_at": title.strip(), "updated_label": label.strip()}
    return found


def series_hours(series: dict) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for point in series.get("data") or []:
        if not isinstance(point, dict) or point.get("y") is None:
            continue
        stamp = point.get("name")
        if not isinstance(stamp, str) or len(stamp) < 16:
            continue
        points.append({"time": stamp[:16], "temp_c": round(float(point["y"]), 2)})
    return points


def temperature_models(chart: dict, labels: dict[str, str], updates: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    """Hourly temperature series. The chart draws Ensemble twice; keep one."""
    chosen: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for series in chart.get("series") or []:
        if series.get("yAxis") != 0:
            continue
        units = (series.get("custom") or {}).get("units")
        if units not in (None, "°C"):
            continue
        code = str(series.get("name") or "").strip()
        if not code:
            continue
        hours = series_hours(series)
        if not hours:
            continue
        current = chosen.get(code)
        if current is not None and (current.get("_units") or not units):
            continue
        name = labels.get(code, code)
        meta = updates.get(name, {})
        chosen[code] = {
            "code": code,
            "name": name,
            "updated_at": meta.get("updated_at") or None,
            "updated_label": meta.get("updated_label") or None,
            "hours": hours,
            "_units": units,
        }
        if code not in order:
            order.append(code)
    models = []
    for code in order:
        row = chosen[code]
        row.pop("_units", None)
        models.append(row)
    return models


def forecast_dates(models: list[dict[str, Any]]) -> list[str]:
    """The three local dates that actually cover a day, not the closing midnight."""
    longest: dict[str, int] = {}
    for model in models:
        counts: dict[str, int] = {}
        for point in model["hours"]:
            day = str(point["time"])[:10]
            counts[day] = counts.get(day, 0) + 1
        for day, count in counts.items():
            longest[day] = max(longest.get(day, 0), count)
    return [day for day in sorted(longest) if longest[day] >= 6][:3]


def location_name(chart: dict, fallback: str) -> str:
    title = chart.get("title") or {}
    text = title.get("text") if isinstance(title, dict) else None
    if isinstance(text, str) and text.strip():
        return text.strip()
    return fallback


def fetch_station(station: dict[str, Any]) -> dict[str, Any]:
    url = page_url(station["slug"])
    page_html = http_bytes(url, "text/html").decode("utf-8", "replace")
    href = chart_url(url, page_html)
    chart = json.loads(http_bytes(href, "application/json", referer=url).decode("utf-8"))
    models = temperature_models(chart, model_labels(page_html), model_updates(page_html))
    if not models:
        raise RuntimeError("temperature series missing from the 3-day chart")
    return {
        "ok": True,
        "icao": station["icao"],
        "city": station["city"],
        "location": location_name(chart, station["city"]),
        "timezone": station["timezone"],
        "unit": station["unit"],
        "lat": station["lat"],
        "lon": station["lon"],
        "page_url": url,
        "forecast_days": forecast_dates(models),
        "models": models,
    }


def atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def capture_path(out_dir: Path, day: str) -> Path:
    return out_dir / f"{day}.json"


def station_zone(station: dict[str, Any]) -> ZoneInfo:
    return ZoneInfo(station["timezone"])


def pending_station(station: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "pending": True,
        "icao": station["icao"],
        "city": station["city"],
        "timezone": station["timezone"],
        "unit": station["unit"],
        "lat": station["lat"],
        "lon": station["lon"],
        "error": "waiting for 08:00 local",
    }


def current_slot(local: datetime) -> str | None:
    """Slot open only within SLOT_GRACE after its start. Missed slots stay empty."""
    for slot in SLOTS:
        start = datetime.combine(local.date(), slot, tzinfo=local.tzinfo)
        if start <= local < start + SLOT_GRACE:
            return slot.strftime("%H:%M")
    return None


def run_done(record: dict[str, Any] | None, slot: str) -> bool:
    if not record:
        return False
    for run in record.get("runs") or []:
        if run.get("slot") != slot:
            continue
        return bool(run.get("ok") or run.get("captured_at") or run.get("error"))
    return False


def station_identity(station: dict[str, Any]) -> dict[str, Any]:
    return {
        "icao": station["icao"],
        "city": station["city"],
        "timezone": station["timezone"],
        "unit": station["unit"],
        "lat": station["lat"],
        "lon": station["lon"],
    }


def adopt_legacy_run(record: dict[str, Any], file_slot: str) -> dict[str, Any]:
    """Keep a one-shot capture as its own run when the first timed run arrives."""
    if record.get("runs") or not (record.get("models") or record.get("captured_at")):
        return record
    legacy = {
        key: record[key]
        for key in ("ok", "captured_at", "forecast_days", "models", "wunderground", "error", "location", "page_url")
        if key in record
    }
    legacy["slot"] = file_slot or "manuel"
    record["runs"] = [legacy]
    for key in ("models", "forecast_days", "wunderground", "error", "pending"):
        record.pop(key, None)
    return record


def apply_run(existing: dict[str, Any] | None, station: dict[str, Any], run: dict[str, Any], file_slot: str) -> dict[str, Any]:
    base = adopt_legacy_run(dict(existing), file_slot) if existing and not existing.get("pending") else station_identity(station)
    if existing and not existing.get("pending"):
        for key in ("location", "page_url"):
            if existing.get(key) and not base.get(key):
                base[key] = existing[key]
    runs = [item for item in base.get("runs") or [] if item.get("slot") != run.get("slot")]
    runs.append(run)
    runs.sort(key=lambda item: str(item.get("slot") or ""))
    base["runs"] = runs
    base["ok"] = any(bool(item.get("ok")) for item in runs)
    base["pending"] = False
    base["captured_at"] = run.get("captured_at")
    if run.get("location"):
        base["location"] = run["location"]
    if run.get("page_url"):
        base["page_url"] = run["page_url"]
    return base


def station_done(record: dict[str, Any] | None) -> bool:
    """A slot already attempted, including a failed fetch. Pending rows are still due."""
    if not record or record.get("pending"):
        return False
    return bool(record.get("ok") or record.get("captured_at") or record.get("error"))


def blank_payload() -> dict[str, Any]:
    return {
        "captured_at": None,
        "slot": "08:00",
        "timezone": "local",
        "source": "meteoblue multimodel 3 days",
        "stations": [],
    }


def read_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        return blank_payload()
    payload = json.loads(path.read_text())
    payload.setdefault("stations", [])
    return payload


def merge_day(out_dir: Path, day: str, updates: list[tuple[dict[str, Any], dict[str, Any]]], targets: list[dict[str, Any]]) -> dict[str, Any]:
    path = capture_path(out_dir, day)
    payload = read_payload(path)
    file_slot = str(payload.get("slot") or "manuel")
    by_icao = {row["icao"]: row for row in payload["stations"] if row.get("icao")}
    for station, run in updates:
        by_icao[station["icao"]] = apply_run(by_icao.get(station["icao"]), station, run, file_slot)
    payload["stations"] = [by_icao.get(station["icao"]) or pending_station(station) for station in targets]
    captured = [
        run.get("captured_at")
        for row in payload["stations"]
        for run in (row.get("runs") or [])
        if run.get("captured_at")
    ]
    if captured:
        payload["captured_at"] = max(captured)
    payload["slots"] = list(SLOT_LABELS)
    payload["timezone"] = "local"
    payload.pop("slot", None)
    atomic_write(path, payload)
    print(f"saved {path}", flush=True)
    return payload


def capture_run(station: dict[str, Any], slot: str) -> dict[str, Any]:
    captured_at = datetime.now(station_zone(station)).isoformat(timespec="seconds")
    try:
        record = fetch_station(station)
    except Exception as exc:
        record = {"ok": False, "error": str(exc)}
        print(f"  {station['icao']} {slot} FAIL {exc}", flush=True)
    else:
        days = ",".join(record["forecast_days"])
        print(f"  {station['icao']} {slot} ok models={len(record['models'])} days={days}", flush=True)
    record["slot"] = slot
    record["captured_at"] = captured_at
    wunderground = fetch_wunderground(station["icao"])
    if wunderground.get("ok"):
        record["wunderground"] = {
            "ok": True,
            "name": "Wunderground",
            "updated_label": "forecast",
            "captured_at": captured_at,
            "hours": wunderground["hours"],
            "daily_max_c": wunderground.get("daily_max_c") or {},
        }
        print(f"  {station['icao']} {slot} wunderground hours={len(wunderground['hours'])}", flush=True)
    else:
        record["wunderground"] = {"ok": False, "captured_at": captured_at}
        print(f"  {station['icao']} {slot} wunderground FAIL", flush=True)
    return record


def due_stations(out_dir: Path, targets: list[dict[str, Any]], only_due: bool) -> dict[str, list[tuple[dict[str, Any], str]]]:
    """Stations grouped by local date, each with the one slot to capture now."""
    now = now_utc()
    groups: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for station in targets:
        local = now.astimezone(station_zone(station))
        day = local.date().isoformat()
        slot = current_slot(local) if only_due else (current_slot(local) or "manuel")
        if slot is None:
            continue
        existing = {row.get("icao"): row for row in read_payload(capture_path(out_dir, day))["stations"]}
        if only_due and run_done(existing.get(station["icao"]), slot):
            continue
        groups.setdefault(day, []).append((station, slot))
    return groups


def fetch_due(out_dir: Path, icaos: list[str] | None, only_due: bool) -> list[dict[str, Any]]:
    targets = station_rows(icaos)
    groups = due_stations(out_dir, targets, only_due)
    captured: list[dict[str, Any]] = []
    started = False
    for day in sorted(groups):
        items = groups[day]
        names = ",".join(f"{station['icao']}@{slot}" for station, slot in items)
        print(f"{now_paris().isoformat(timespec='seconds')} meteoblue {day} {names}", flush=True)
        updates = []
        for station, slot in items:
            if started:
                time.sleep(STATION_GAP_S)
            started = True
            updates.append((station, capture_run(station, slot)))
        merge_day(out_dir, day, updates, targets)
        captured.extend(run for _, run in updates)
    return captured


def fetch_all(out_dir: Path, icaos: list[str] | None, slot: str) -> dict[str, Any]:
    del slot
    captured = fetch_due(out_dir, icaos, only_due=False)
    return {"stations": captured}


def to_unit(temp_c: float, unit: str) -> float:
    if unit == "F":
        return temp_c * 9.0 / 5.0 + 32.0
    return temp_c


def unit_symbol(unit: str) -> str:
    return "°F" if unit == "F" else "°C"


def local_today(station: dict[str, Any]) -> str:
    return datetime.now(ZoneInfo(station["timezone"])).date().isoformat()


def parse_obs_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def http_json_url(url: str, timeout: float = 12) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
    if not raw.strip():
        raise ValueError("empty body")
    return json.loads(raw)


def polymarket_slug(icao: str, day: str) -> str | None:
    city = POLYMARKET_CITY.get(icao)
    parts = day.split("-")
    if not city or len(parts) != 3:
        return None
    year, month, date = (int(part) for part in parts)
    if month < 1 or month > 12:
        return None
    return f"highest-temperature-in-{city}-on-{POLYMARKET_MONTHS[month - 1]}-{date}-{year}"


def parse_bucket_label(label: str) -> tuple[int | None, int | None, str] | None:
    """Polymarket bucket bounds. Open tails use None on the unbounded side."""
    text = re.sub(r"\s+", " ", label).strip()
    match = re.match(r"^(-?\d+)°([CF]) or below$", text, re.I)
    if match:
        return None, int(match.group(1)), match.group(2).upper()
    match = re.match(r"^(-?\d+)°([CF]) or (?:higher|above)$", text, re.I)
    if match:
        return int(match.group(1)), None, match.group(2).upper()
    match = re.match(r"^(-?\d+)\s?(?:-|–|to)\s?(-?\d+)°([CF])$", text, re.I)
    if match:
        lo, hi = int(match.group(1)), int(match.group(2))
        return min(lo, hi), max(lo, hi), match.group(3).upper()
    match = re.match(r"^(-?\d+)°([CF])$", text, re.I)
    if match:
        value = int(match.group(1))
        return value, value, match.group(2).upper()
    return None


def bucket_sort_key(bucket: dict[str, Any]) -> float:
    lo, hi = bucket.get("lo"), bucket.get("hi")
    if lo is None:
        return (hi - 0.5) if isinstance(hi, int) else -1e9
    return float(lo)


def yes_price(market: dict) -> float | None:
    try:
        outcomes = json.loads(market.get("outcomes") or "[]")
        prices = json.loads(market.get("outcomePrices") or "[]")
        if not isinstance(outcomes, list) or not isinstance(prices, list):
            return None
        idx = next((i for i, name in enumerate(outcomes) if str(name).lower() == "yes"), 0)
        raw = float(prices[idx])
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return raw if raw == raw else None


def fetch_polymarket(icao: str, day: str) -> dict[str, Any]:
    slug = polymarket_slug(icao, day)
    if not slug:
        return {"ok": False}
    url = "https://gamma-api.polymarket.com/events?" + urllib.parse.urlencode({"slug": slug})
    try:
        payload = http_json_url(url)
    except Exception:
        return {"ok": False}
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        return {"ok": False}
    event = payload[0]
    favorite = None
    best = -1.0
    buckets: list[dict[str, Any]] = []
    for market in event.get("markets") or []:
        if not isinstance(market, dict):
            continue
        price = yes_price(market)
        label = str(market.get("groupItemTitle") or market.get("question") or "").strip()
        parsed = parse_bucket_label(label)
        if parsed:
            lo, hi, unit = parsed
            buckets.append({
                "label": label,
                "lo": lo,
                "hi": hi,
                "unit": unit,
                "price": None if price is None else round(price, 4),
            })
        if price is None or not label or price <= best:
            continue
        best = price
        favorite = {"label": label, "cents": int(round(price * 100))}
    buckets.sort(key=bucket_sort_key)
    event_slug = event.get("slug") or slug
    return {
        "ok": True,
        "url": f"https://polymarket.com/event/{event_slug}",
        "title": event.get("title") or None,
        "closed": bool(event.get("closed")),
        "unit": next((row["unit"] for row in buckets if row.get("unit")), None),
        "favorite": favorite,
        "buckets": buckets,
    }


def fetch_metar_days(station: dict[str, Any], days: list[str]) -> dict[str, dict[str, Any]]:
    """Highest METAR temperature for each requested local date, today or earlier."""
    today = local_today(station)
    wanted = {day for day in days if day <= today}
    if not wanted:
        return {}
    icao = station["icao"]
    unit = station.get("unit") or "C"
    tz = ZoneInfo(station["timezone"])
    try:
        payload = http_json_url(f"{METAR_BASE}?ids={icao}&format=json&hours=72")
    except Exception:
        return {day: {"ok": False} for day in wanted}
    if not isinstance(payload, list):
        return {day: {"ok": False} for day in wanted}
    running: dict[str, tuple[float, str]] = {}
    for obs in payload:
        if not isinstance(obs, dict):
            continue
        temp = obs.get("temp")
        instant = parse_obs_time(obs.get("reportTime") or obs.get("obsTime") or obs.get("receiptTime"))
        if not isinstance(temp, (int, float)) or instant is None:
            continue
        local_day = instant.astimezone(tz).date().isoformat()
        if local_day not in wanted:
            continue
        value = float(temp)
        previous = running.get(local_day)
        if previous is None or value > previous[0]:
            running[local_day] = (value, instant.astimezone(timezone.utc).isoformat(timespec="seconds"))
    found: dict[str, dict[str, Any]] = {}
    for day in wanted:
        hit = running.get(day)
        if hit is None:
            found[day] = {"ok": False}
            continue
        value, at = hit
        found[day] = {
            "ok": True,
            "max": round(to_unit(value, unit), 1),
            "unit": unit,
            "at": at,
        }
    return found


def fetch_wunderground(icao: str) -> dict[str, Any]:
    """Hourly forecast plus the published daily high, both in °C."""
    query = urllib.parse.urlencode({
        "icaoCode": icao,
        "units": "m",
        "language": "en-US",
        "format": "json",
        "apiKey": WU_KEY,
    })
    hours: list[dict[str, Any]] = []
    try:
        hourly = http_json_url(WU_HOURLY + "?" + query, timeout=20)
    except Exception:
        hourly = None
    if isinstance(hourly, dict):
        times = hourly.get("validTimeLocal") or []
        temps = hourly.get("temperature") or []
        for stamp, temp in zip(times, temps):
            if not isinstance(stamp, str) or len(stamp) < 16 or not isinstance(temp, (int, float)):
                continue
            hours.append({"time": stamp[:10] + " " + stamp[11:16], "temp_c": round(float(temp), 2)})
    daily_max_c: dict[str, float] = {}
    try:
        daily = http_json_url(WU_DAILY + "?" + query, timeout=20)
    except Exception:
        daily = None
    if isinstance(daily, dict):
        dates = daily.get("validTimeLocal") or []
        daytime = daily.get("temperatureMax") or []
        calendar = daily.get("calendarDayTemperatureMax") or []
        for index, stamp in enumerate(dates):
            if not isinstance(stamp, str) or len(stamp) < 10:
                continue
            chosen = daytime[index] if index < len(daytime) else None
            if not isinstance(chosen, (int, float)):
                chosen = calendar[index] if index < len(calendar) else None
            if isinstance(chosen, (int, float)):
                daily_max_c[stamp[:10]] = round(float(chosen), 2)
    if not hours and not daily_max_c:
        return {"ok": False}
    return {
        "ok": True,
        "name": "Wunderground",
        "updated_label": "forecast",
        "hours": hours,
        "daily_max_c": daily_max_c,
    }


def station_context(icao: str, days: list[str]) -> dict[str, Any]:
    station = BY_ICAO.get(icao)
    if station is None:
        raise KeyError(icao)
    wanted = [day for day in days if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day)][:3]
    cache_key = (icao, ",".join(wanted))
    now = time.time()
    with _CONTEXT_LOCK:
        cached = _CONTEXT_CACHE.get(cache_key)
        if cached and now - cached[0] < CONTEXT_TTL_S:
            return cached[1]
    today = local_today(station)
    days_out: dict[str, dict[str, Any]] = {day: {} for day in wanted}
    wunderground: dict[str, Any] | None = None
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = {pool.submit(fetch_polymarket, icao, day): ("pm", day) for day in wanted}
        jobs[pool.submit(fetch_metar_days, station, wanted)] = ("metar", "")
        jobs[pool.submit(fetch_wunderground, icao)] = ("wu", "")
        for future in jobs:
            kind, day = jobs[future]
            try:
                value = future.result()
            except Exception:
                continue
            if kind == "pm" and isinstance(value, dict) and value.get("ok"):
                days_out[day]["polymarket"] = value
            elif kind == "wu" and isinstance(value, dict) and value.get("ok"):
                wunderground = value
            elif kind == "metar" and isinstance(value, dict):
                for metar_day, row in value.items():
                    if isinstance(row, dict) and row.get("ok") and metar_day in days_out:
                        days_out[metar_day]["metar"] = row
    payload = {"icao": icao, "local_today": today, "days": days_out, "wunderground": wunderground}
    with _CONTEXT_LOCK:
        _CONTEXT_CACHE[cache_key] = (now, payload)
    return payload


def day_hours(model: dict[str, Any], day: str, unit: str) -> dict[str, float]:
    found: dict[str, float] = {}
    for point in model.get("hours") or []:
        stamp = str(point.get("time") or "")
        if stamp[:10] != day:
            continue
        clock = stamp[11:16]
        if clock not in HOURS:
            continue
        found[clock] = round(to_unit(float(point["temp_c"]), unit), 1)
    return found


def day_view(station: dict[str, Any], day: str) -> dict[str, Any]:
    unit = station.get("unit") or "C"
    rows = []
    peak: float | None = None
    for model in station.get("models") or []:
        hours = day_hours(model, day, unit)
        model_max = max(hours.values()) if hours else None
        rows.append({
            "name": model.get("name") or model.get("code"),
            "updated_label": model.get("updated_label"),
            "hours": hours,
            "max": model_max,
        })
        if model_max is not None and (peak is None or model_max > peak):
            peak = model_max
    winners = []
    if peak is not None:
        for row in rows:
            clocks = [clock for clock, value in row["hours"].items() if value == peak]
            if clocks:
                winners.append({"name": row["name"], "hours": clocks})
    return {"day": day, "unit": unit, "peak": peak, "winners": winners, "rows": rows}


def format_winners(winners: list[dict[str, Any]]) -> str:
    parts = []
    for winner in winners:
        clocks = ", ".join(winner["hours"])
        parts.append(f"{winner['name']} {clocks}")
    return " · ".join(parts)


def ansi(text: str, kind: str, color: bool) -> str:
    if not color or kind == "":
        return text
    if kind == "day":
        return f"\033[1;30;43m{text}\033[0m"
    if kind == "max":
        return f"\033[1m{text}\033[0m"
    return text


def render_text(payload: dict[str, Any], icaos: set[str] | None, color: bool) -> str:
    lines: list[str] = []
    captured = payload.get("captured_at") or ""
    lines.append(f"Capturé {captured} (Europe/Paris) · slot {payload.get('slot')}")
    shown = 0
    for station in payload.get("stations") or []:
        if icaos and station.get("icao") not in icaos:
            continue
        shown += 1
        lines.append("")
        title = f"{station.get('icao')}  {station.get('city')}"
        location = station.get("location")
        if location and location != station.get("city"):
            title += f"  {location}"
        lines.append(title)
        if station.get("pending") and not station.get("runs"):
            lines.append("  en attente de 08:00 locale")
            continue
        runs = station.get("runs") or []
        if not runs and (station.get("models") or station.get("captured_at")):
            legacy = dict(station)
            legacy["slot"] = payload.get("slot") or "manuel"
            runs = [legacy]
        if not runs:
            if not station.get("ok"):
                lines.append(f"  échec : {station.get('error')}")
            continue
        symbol = unit_symbol(station.get("unit") or "C")
        for run in runs:
            lines.append("")
            lines.append(f"  {run.get('slot')}  {run.get('captured_at') or ''}")
            if not run.get("ok"):
                lines.append(f"  échec : {run.get('error')}")
                continue
            view_source = dict(run)
            view_source["unit"] = station.get("unit")
            for day in run.get("forecast_days") or []:
                view = day_view(view_source, day)
                lines.append("")
                if view["peak"] is None:
                    lines.append(f"{day}  pas de température")
                    continue
                lines.append(f"{day}  max {view['peak']:.1f}{symbol}  {format_winners(view['winners'])}")
                header = f"{'Modèle':<14} {'Max':>6}" + "".join(f"{clock[:2]:>6}" for clock in HOURS)
                lines.append(header)
                for row in view["rows"]:
                    max_kind = "day" if row["max"] is not None and row["max"] == view["peak"] else "max"
                    max_text = f"{row['max']:6.1f}" if row["max"] is not None else f"{'·':>6}"
                    cells = [f"{row['name']:<14}", ansi(max_text, max_kind if row["max"] is not None else "", color)]
                    for clock in HOURS:
                        value = row["hours"].get(clock)
                        if value is None:
                            cells.append(f"{'·':>6}")
                            continue
                        kind = "day" if value == view["peak"] else ""
                        cells.append(ansi(f"{value:6.1f}", kind, color))
                    lines.append("".join(cells))
    if shown == 0:
        lines.append("aucune station dans ce fichier")
    return "\n".join(lines) + "\n"


def capture_dates(out_dir: Path) -> list[str]:
    return [item.stem for item in sorted(out_dir.glob("????-??-??.json"))]


def latest_capture(out_dir: Path, day: str | None) -> tuple[Path, dict[str, Any]]:
    if day:
        path = capture_path(out_dir, day)
        if not path.exists():
            raise SystemExit(f"pas de capture pour {day} ({path})")
    else:
        files = sorted(out_dir.glob("????-??-??.json"))
        if not files:
            raise SystemExit(f"aucune capture dans {out_dir}")
        path = files[-1]
    return path, json.loads(path.read_text())


def show(out_dir: Path, day: str | None, icaos: list[str] | None) -> int:
    _, payload = latest_capture(out_dir, day)
    selected = {row["icao"] for row in station_rows(icaos)} if icaos else None
    sys.stdout.write(render_text(payload, selected, sys.stdout.isatty()))
    return 0


def sleep_until(target: datetime) -> None:
    while True:
        remaining = (target - now_utc()).total_seconds()
        if remaining <= 0:
            return
        time.sleep(min(remaining, 60))


def next_local_slot(station: dict[str, Any], instant: datetime) -> datetime:
    local = instant.astimezone(station_zone(station))
    for slot in SLOTS:
        candidate = datetime.combine(local.date(), slot, tzinfo=local.tzinfo)
        if candidate > local:
            return candidate
    tomorrow = local.date() + timedelta(days=1)
    return datetime.combine(tomorrow, SLOTS[0], tzinfo=local.tzinfo)


def loop(out_dir: Path, icaos: list[str] | None) -> None:
    print("loop at 08:00, 10:30 and 13:30 in each station's timezone", flush=True)
    while True:
        targets = station_rows(icaos)
        if fetch_due(out_dir, icaos, only_due=True):
            continue
        nxt = min(next_local_slot(station, now_utc()) for station in targets)
        print(f"next capture {nxt.isoformat(timespec='seconds')}", flush=True)
        sleep_until(nxt)


class ReportHandler(BaseHTTPRequestHandler):
    out_dir: Path

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, payload: object) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, raw, "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path in ("/", "/index.html"):
            self._send(200, DASHBOARD_HTML.read_bytes(), "text/html; charset=utf-8")
            return
        if path == "/api/capture":
            day = (parse_qs(parsed.query).get("date") or [None])[0] or None
            try:
                _, payload = latest_capture(self.out_dir, day)
            except SystemExit as exc:
                self._send_json(404, {"error": str(exc)})
                return
            self._send_json(200, {"dates": capture_dates(self.out_dir), "payload": payload})
            return
        if path == "/api/context":
            icao = ((parse_qs(parsed.query).get("icao") or [""])[0] or "").upper()
            days = [part for part in ((parse_qs(parsed.query).get("days") or [""])[0] or "").split(",") if part]
            if icao not in BY_ICAO:
                self._send_json(404, {"error": f"unknown station {icao}"})
                return
            self._send_json(200, station_context(icao, days))
            return
        self._send(404, b"not found\n", "text/plain; charset=utf-8")


def start_server(host: str, port: int, out_dir: Path) -> ThreadingHTTPServer:
    handler = type("BoundReportHandler", (ReportHandler,), {"out_dir": out_dir})
    httpd = ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=httpd.serve_forever, name="meteoblue-report", daemon=True)
    thread.start()
    print(f"report http://{host}:{port}", flush=True)
    return httpd


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--loop", action="store_true", help="capture each station at 08:00, 10:30 and 13:30 local and serve :5004")
    parser.add_argument("--serve", action="store_true", help="serve the report on :5004 without capturing")
    parser.add_argument("--show", action="store_true", help="print hour × model tables for a capture")
    parser.add_argument("--date", help="capture date YYYY-MM-DD (default: latest)")
    parser.add_argument("--icao", action="append", default=[], help="limit to one station; repeatable")
    parser.add_argument("--host", default="0.0.0.0", help="report bind address")
    parser.add_argument("--port", type=int, default=5004, help="report port")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "data" / "meteoblue")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = args.out_dir if args.out_dir.is_absolute() else ROOT / args.out_dir
    icaos = args.icao or None
    httpd = start_server(args.host, args.port, out_dir) if args.loop or args.serve else None
    try:
        if args.show:
            return show(out_dir, args.date, icaos)
        if args.loop:
            loop(out_dir, icaos)
            return 0
        if args.serve:
            threading.Event().wait()
            return 0
        payload = fetch_all(out_dir, icaos, "manual")
        failed = sum(1 for run in payload["stations"] if not run.get("ok"))
        return 1 if failed else 0
    finally:
        if httpd:
            httpd.shutdown()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
