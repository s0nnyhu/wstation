#!/usr/bin/env python3
"""Archive live /api/stations payloads and serve them on a local dashboard.

Default: one capture (cron-friendly).
--loop: capture at 06:15, 09:15, 13:15, 14:15 station-local, METAR max at 21:00
station-local, and serve :5002 on 0.0.0.0.
--metar: fetch today's METAR resolved max now.
--serve: dashboard only (no capture loop).

    python3 scripts/snapshot_stations.py --loop --host 0.0.0.0 --port 5002
    sudo ./scripts/install-snapshots-systemd.sh
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, time as dtime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PARIS = ZoneInfo("Europe/Paris")
SLOTS = (dtime(6, 15), dtime(9, 15), dtime(13, 15), dtime(14, 15))
SLOT_GRACE = timedelta(minutes=15)
STATIONS = (
    "EDDM",
    "EGLC",
    "LIMC",
    "LFPB",
    "LTAC",
    "EFHK",
    "EPWA",
    "EHAM",
    "ZSPD",
    "ZGSZ",
    "ZHHH",
    "ZUUU",
    "RJTT",
    "KHOU",
    "KDAL",
    "KLGA",
)
STATION_TZ = {
    "EDDM": "Europe/Berlin",
    "EGLC": "Europe/London",
    "LIMC": "Europe/Rome",
    "LFPB": "Europe/Paris",
    "LTAC": "Europe/Istanbul",
    "EFHK": "Europe/Helsinki",
    "EPWA": "Europe/Warsaw",
    "EHAM": "Europe/Amsterdam",
    "ZSPD": "Asia/Shanghai",
    "ZGSZ": "Asia/Shanghai",
    "ZHHH": "Asia/Shanghai",
    "ZUUU": "Asia/Shanghai",
    "RJTT": "Asia/Tokyo",
    "KHOU": "America/Chicago",
    "KDAL": "America/Chicago",
    "KLGA": "America/New_York",
}
STATION_CITY = {
    "EDDM": "Munich",
    "EGLC": "London",
    "LIMC": "Milan",
    "LFPB": "Paris",
    "LTAC": "Ankara",
    "EFHK": "Helsinki",
    "EPWA": "Warsaw",
    "EHAM": "Amsterdam",
    "ZSPD": "Shanghai",
    "ZGSZ": "Shenzhen",
    "ZHHH": "Wuhan",
    "ZUUU": "Chengdu",
    "RJTT": "Tokyo",
    "KHOU": "Houston",
    "KDAL": "Dallas",
    "KLGA": "New York",
}
METAR_SLOT = dtime(21, 0)
DEFAULT_BASE = "https://wstation-sepia.vercel.app/api/stations"
METAR_BASE = "https://aviationweather.gov/api/data/metar"
UA = "WStation/0.1 station snapshot"
TIMEOUT_S = 60
RETRIES = 3
# Open-Meteo 429 is wrapped as HTTP 502 {"error":"Open-Meteo HTTP 429"}.
# A 1/2/4s retry lands in the same quota window and makes the limit worse.
RATE_LIMIT_RETRIES = 4
STATION_GAP_S = 12.0
DASHBOARD_HTML = Path(__file__).with_name("snapshot_dashboard.html")


def now_paris() -> datetime:
    return datetime.now(PARIS)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def station_zone(icao: str) -> ZoneInfo:
    return ZoneInfo(STATION_TZ[icao])


def station_unit(icao: str) -> str:
    return "F" if STATION_TZ[icao].startswith("America/") else "C"


def station_region(icao: str) -> str:
    tz = STATION_TZ[icao]
    if tz.startswith("America/"):
        return "america"
    if tz.startswith("Asia/"):
        return "asia"
    return "europe"


def local_date(icao: str, instant: datetime | None = None) -> str:
    return (instant or now_utc()).astimezone(station_zone(icao)).date().isoformat()


def slot_label(icao: str, now: datetime | None = None) -> str:
    tz = station_zone(icao)
    local = (now or now_utc()).astimezone(tz)
    for slot in SLOTS:
        start = datetime.combine(local.date(), slot, tzinfo=tz)
        if start <= local < start + SLOT_GRACE:
            return slot.strftime("%H:%M")
    return "manual"


def next_local_clock(icao: str, clock: dtime, now: datetime | None = None) -> datetime:
    tz = station_zone(icao)
    local = (now or now_utc()).astimezone(tz)
    for offset in (0, 1, 2):
        day = local.date() + timedelta(days=offset)
        candidate = datetime.combine(day, clock, tzinfo=tz)
        if candidate > local + timedelta(seconds=15):
            return candidate
    return datetime.combine(local.date() + timedelta(days=1), clock, tzinfo=tz)


def next_forecast_slot(icao: str, now: datetime | None = None) -> datetime:
    tz = station_zone(icao)
    local = (now or now_utc()).astimezone(tz)
    for offset in (0, 1):
        day = local.date() + timedelta(days=offset)
        for slot in SLOTS:
            candidate = datetime.combine(day, slot, tzinfo=tz)
            if candidate > local + timedelta(seconds=15):
                return candidate
    return datetime.combine(local.date() + timedelta(days=1), SLOTS[0], tzinfo=tz)


def next_metar_slot(icao: str, now: datetime | None = None) -> datetime:
    return next_local_clock(icao, METAR_SLOT, now)


def next_forecast_across_stations(now: datetime | None = None) -> tuple[datetime, str]:
    instant = now or now_utc()
    return min(
        ((next_forecast_slot(icao, instant), icao) for icao in STATIONS),
        key=lambda row: (row[0], row[1]),
    )


def next_event(now: datetime | None = None) -> tuple[datetime, str, str]:
    instant = now or now_utc()
    candidates: list[tuple[datetime, str, str]] = []
    for icao in STATIONS:
        candidates.append((next_forecast_slot(icao, instant), "forecast", icao))
        candidates.append((next_metar_slot(icao, instant), "metar", icao))
    return min(candidates, key=lambda row: (row[0], row[1], row[2]))


def _error_body(exc: urllib.error.HTTPError) -> bytes:
    try:
        return exc.read() or b""
    except Exception:
        return b""


def _rate_limited(code: int, body: bytes) -> bool:
    if code == 429:
        return True
    lowered = body.lower()
    return b"429" in body and (b"open-meteo" in lowered or b"too many" in lowered or b"rate" in lowered)


def _retry_wait(exc: urllib.error.HTTPError, body: bytes, attempt: int, limited: bool) -> float:
    if not limited:
        return float(2**attempt)
    header = exc.headers.get("Retry-After") if exc.headers else None
    if header:
        try:
            return min(120.0, max(1.0, float(header)))
        except ValueError:
            pass
    return min(60.0, 30.0 * (attempt + 1))


def http_json(url: str) -> dict:
    last: Exception | None = None
    label = url.rstrip("/").rsplit("/", 1)[-1]
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                raw = res.read()
            if not raw.strip():
                raise ValueError("empty body")
            payload = json.loads(raw)
            return payload
        except urllib.error.HTTPError as e:
            last = e
            body = _error_body(e)
            limited = _rate_limited(e.code, body)
            retryable = limited or e.code in (429, 500, 502, 503, 504)
            cap = RATE_LIMIT_RETRIES if limited else RETRIES
            if retryable and attempt < cap:
                wait = _retry_wait(e, body, attempt, limited)
                reason = "rate limit" if limited else f"HTTP {e.code}"
                print(
                    f"    {label} {reason} — retry in {wait:.0f}s ({attempt + 1}/{cap})",
                    flush=True,
                )
                time.sleep(wait)
                continue
            raise RuntimeError(f"HTTP {e.code} {body[:300]!r}") from e
        except Exception as e:
            last = e
            if attempt < RETRIES:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(str(last))


def http_json_obj(url: str) -> dict:
    payload = http_json(url)
    if not isinstance(payload, dict):
        raise ValueError(f"expected object, got {type(payload).__name__}")
    return payload


SLOT_RANK = {slot.strftime("%H:%M"): i for i, slot in enumerate(SLOTS)}
for i, label in enumerate(("06:00", "09:00", "13:00", "14:00")):
    SLOT_RANK.setdefault(label, i)


def snapshot_day(snap: dict) -> str:
    payload = snap.get("payload") if isinstance(snap.get("payload"), dict) else {}
    market = payload.get("market_date")
    if isinstance(market, str) and len(market) >= 10:
        return market[:10]
    captured = snap.get("captured_at") or ""
    return captured[:10] if len(captured) >= 10 else ""


def snapshot_sort_key(snap: dict) -> tuple:
    rank = SLOT_RANK.get(snap.get("slot") or "", 8)
    return (snapshot_day(snap), rank, snap.get("captured_at") or "")


def sort_snapshots(snaps: list) -> list:
    return sorted(snaps, key=snapshot_sort_key)


def load_file(path: Path) -> dict:
    if not path.exists():
        return {"icao": path.stem, "snapshots": []}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise RuntimeError(f"corrupt snapshot file {path}: {e}") from e
    if isinstance(data, list):
        return {"icao": path.stem, "snapshots": sort_snapshots(data)}
    if isinstance(data, dict) and isinstance(data.get("snapshots"), list):
        data["snapshots"] = sort_snapshots(data["snapshots"])
        return data
    raise RuntimeError(f"unexpected snapshot file shape: {path}")


def atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def snapshot_one(icao: str, base_url: str, out_dir: Path, slot: str | None = None) -> dict:
    url = f"{base_url.rstrip('/')}/{icao}"
    captured_at = now_utc().astimezone(station_zone(icao)).isoformat(timespec="seconds")
    slot = slot or slot_label(icao)
    try:
        body = http_json_obj(url)
        record = {
            "ok": True,
            "slot": slot,
            "captured_at": captured_at,
            "url": url,
            "payload": body,
        }
    except Exception as e:
        record = {
            "ok": False,
            "slot": slot,
            "captured_at": captured_at,
            "url": url,
            "error": str(e),
        }
    path = out_dir / f"{icao}.json"
    file_data = load_file(path)
    file_data["icao"] = icao
    file_data.setdefault("url", url)
    snaps = file_data.setdefault("snapshots", [])
    snaps.append(record)
    file_data["snapshots"] = sort_snapshots(snaps)
    atomic_write(path, file_data)
    return record


def _pause_before_station(index: int) -> None:
    if index > 0 and STATION_GAP_S > 0:
        time.sleep(STATION_GAP_S)


def capture(
    base_url: str,
    out_dir: Path,
    icaos: list[str] | None = None,
    slots: dict[str, str] | None = None,
) -> int:
    targets = list(icaos) if icaos is not None else list(STATIONS)
    failures = 0
    print(f"{now_paris().isoformat(timespec='seconds')} stations={','.join(targets)}", flush=True)
    for index, icao in enumerate(targets):
        _pause_before_station(index)
        record = snapshot_one(icao, base_url, out_dir, slot=(slots or {}).get(icao))
        if record["ok"]:
            market = (record.get("payload") or {}).get("market_date")
            print(f"  {icao} ok slot={record.get('slot')} market_date={market}", flush=True)
        else:
            failures += 1
            print(f"  {icao} FAIL {record.get('error')}", flush=True)
    return failures


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


def metar_max_from_aw(icao: str, market_date: str) -> dict:
    url = f"{METAR_BASE}?ids={icao}&format=json&hours=36"
    payload = http_json(url)
    if not isinstance(payload, list):
        raise ValueError("METAR payload is not a list")
    tz = station_zone(icao)
    running = None
    running_at = None
    resolution = None
    n = 0
    for obs in payload:
        if not isinstance(obs, dict):
            continue
        temp = obs.get("temp")
        if not isinstance(temp, (int, float)):
            continue
        instant = parse_obs_time(obs.get("reportTime") or obs.get("obsTime") or obs.get("receiptTime"))
        if instant is None:
            continue
        if instant.astimezone(tz).date().isoformat() != market_date:
            continue
        n += 1
        temp_f = float(temp)
        if running is None or temp_f > running:
            running = temp_f
            running_at = instant.astimezone(timezone.utc).isoformat(timespec="seconds")
        body = js_round(temp_f)
        if resolution is None or body > resolution:
            resolution = body
    if n == 0:
        raise RuntimeError(f"no METAR temps for {icao} on {market_date}")
    return {
        "ok": True,
        "source": "aviationweather",
        "n": n,
        "metar_running_max_c": running,
        "metar_resolution_max_c": resolution,
        "running_max_at": running_at,
    }


def metar_max_from_api(payload: dict) -> dict | None:
    metar = payload.get("metar") if isinstance(payload.get("metar"), dict) else {}
    syn = payload.get("synoptic") if isinstance(payload.get("synoptic"), dict) else {}
    resolution = metar.get("resolution_max_c")
    running = metar.get("running_max_c")
    if resolution is None and running is None and not syn.get("ok"):
        return None
    return {
        "ok": bool(metar.get("ok") or syn.get("ok")),
        "source": "wstation-api",
        "metar_running_max_c": running,
        "metar_resolution_max_c": resolution,
        "running_max_at": metar.get("running_max_at"),
        "synoptic_resolution_max": syn.get("resolution_max") if syn.get("ok") else None,
        "synoptic_unit": syn.get("unit") if syn.get("ok") else None,
    }


FORECAST_SLOTS = set(SLOT_RANK)


def has_daily_obs(out_dir: Path, icao: str, date: str) -> bool:
    data = load_file(out_dir / f"{icao}.json")
    return any(row.get("date") == date and row.get("ok") for row in data.get("daily_obs") or [])


def has_forecast_for_day(out_dir: Path, icao: str, date: str) -> bool:
    data = load_file(out_dir / f"{icao}.json")
    for snap in data.get("snapshots") or []:
        if (
            snap.get("ok")
            and snapshot_day(snap) == date
            and snap.get("slot") in FORECAST_SLOTS
        ):
            return True
    return False


def has_forecast_for_slot(out_dir: Path, icao: str, date: str, slot: str) -> bool:
    data = load_file(out_dir / f"{icao}.json")
    for snap in data.get("snapshots") or []:
        if snap.get("ok") and snapshot_day(snap) == date and snap.get("slot") == slot:
            return True
    return False


def stations_due_for_forecast(now: datetime | None = None) -> list[str]:
    instant = now or now_utc()
    return [icao for icao in STATIONS if slot_label(icao, instant) != "manual"]


def upsert_daily_obs(out_dir: Path, icao: str, record: dict) -> None:
    path = out_dir / f"{icao}.json"
    file_data = load_file(path)
    file_data["icao"] = icao
    obs = [row for row in file_data.get("daily_obs") or [] if row.get("date") != record["date"]]
    obs.append(record)
    file_data["daily_obs"] = sorted(obs, key=lambda row: row.get("date") or "")
    atomic_write(path, file_data)


def capture_metar_one(icao: str, base_url: str, out_dir: Path, force: bool = False) -> dict:
    market_date = local_date(icao)
    if not force and not has_forecast_for_day(out_dir, icao, market_date):
        return {
            "ok": True,
            "icao": icao,
            "date": market_date,
            "skipped": True,
            "reason": "no-forecast",
        }
    if not force and has_daily_obs(out_dir, icao, market_date):
        return {"ok": True, "icao": icao, "date": market_date, "skipped": True}
    captured_at = now_utc().isoformat(timespec="seconds")
    url = f"{base_url.rstrip('/')}/{icao}"
    record: dict[str, Any] = {
        "ok": False,
        "date": market_date,
        "slot": METAR_SLOT.strftime("%H:%M"),
        "timezone": STATION_TZ[icao],
        "captured_at": captured_at,
        "url": url,
    }
    try:
        payload = http_json_obj(url)
        from_api = metar_max_from_api(payload)
        if from_api:
            record.update(from_api)
            record["date"] = payload.get("market_date") or market_date
        else:
            record.update(metar_max_from_aw(icao, payload.get("market_date") or market_date))
            record["date"] = payload.get("market_date") or market_date
        record["ok"] = True
        record["unit"] = payload.get("unit") or station_unit(icao)
        record["city"] = payload.get("city")
    except Exception as e:
        try:
            record.update(metar_max_from_aw(icao, market_date))
            record["ok"] = True
            record["unit"] = station_unit(icao)
        except Exception as fallback:
            record["ok"] = False
            record["error"] = f"{e} | fallback: {fallback}"
    upsert_daily_obs(out_dir, icao, record)
    return record


def catch_up_forecast(base_url: str, out_dir: Path) -> None:
    due = stations_due_for_forecast()
    slots = {icao: slot_label(icao) for icao in due}
    pending = [
        icao
        for icao in due
        if not has_forecast_for_slot(out_dir, icao, local_date(icao), slots[icao])
    ]
    if pending:
        capture(base_url, out_dir, pending, slots)


def catch_up_metar(base_url: str, out_dir: Path) -> None:
    now = now_utc()
    index = 0
    for icao in STATIONS:
        local = now.astimezone(station_zone(icao))
        if local.hour < METAR_SLOT.hour:
            continue
        _pause_before_station(index)
        index += 1
        rec = capture_metar_one(icao, base_url, out_dir)
        if rec.get("skipped"):
            if rec.get("reason") == "no-forecast":
                print(f"  {icao} METAR skip {rec.get('date')} (pas de capture 6h15/9h15/13h15/14h15)", flush=True)
            continue
        if rec.get("ok"):
            print(
                f"  {icao} METAR {rec.get('date')} resolved={rec.get('metar_resolution_max_c')}",
                flush=True,
            )
        else:
            print(f"  {icao} METAR FAIL {rec.get('error')}", flush=True)


def capture_metar(base_url: str, out_dir: Path, force: bool = False) -> int:
    failures = 0
    print(f"{now_paris().isoformat(timespec='seconds')} METAR 21h locale", flush=True)
    for index, icao in enumerate(STATIONS):
        _pause_before_station(index)
        rec = capture_metar_one(icao, base_url, out_dir, force=force)
        if rec.get("skipped"):
            reason = rec.get("reason")
            extra = " (pas de capture 6h15/9h15/13h15/14h15)" if reason == "no-forecast" else ""
            print(f"  {icao} skip {rec.get('date')}{extra}", flush=True)
            continue
        if rec.get("ok"):
            print(
                f"  {icao} {rec.get('date')} resolved={rec.get('metar_resolution_max_c')} "
                f"running={rec.get('metar_running_max_c')}",
                flush=True,
            )
        else:
            failures += 1
            print(f"  {icao} FAIL {rec.get('error')}", flush=True)
    return failures


def sleep_until(target: datetime) -> None:
    while True:
        remaining = (target - now_utc()).total_seconds()
        if remaining <= 0:
            return
        time.sleep(min(remaining, 60))


def station_summary(icao: str, out_dir: Path) -> dict:
    data = load_file(out_dir / f"{icao}.json")
    snaps = data.get("snapshots") or []
    latest = snaps[-1] if snaps else None
    payload = (latest or {}).get("payload") or {}
    return {
        "icao": icao,
        "city": payload.get("city") or data.get("city") or STATION_CITY.get(icao, ""),
        "name": payload.get("name"),
        "timezone": payload.get("timezone") or STATION_TZ[icao],
        "region": payload.get("region") or station_region(icao),
        "n": len(snaps),
        "latest": latest,
    }


def dashboard_index(out_dir: Path) -> dict:
    summaries = [station_summary(icao, out_dir) for icao in STATIONS]
    by_day: dict[str, dict[str, list]] = {}
    cities: dict[str, str] = {}
    metar_by: dict[str, dict[str, dict]] = {}
    for row in summaries:
        icao = row["icao"]
        cities[icao] = row.get("city") or ""
        data = load_file(out_dir / f"{icao}.json")
        metar_by[icao] = {
            obs.get("date"): obs
            for obs in data.get("daily_obs") or []
            if obs.get("date")
        }
        for snap in data.get("snapshots") or []:
            by_day.setdefault(snapshot_day(snap) or "unknown", {}).setdefault(icao, []).append(snap)
        for date in metar_by[icao]:
            by_day.setdefault(date, {}).setdefault(icao, [])
    days = []
    for date in sorted(by_day, reverse=True):
        stations = []
        for icao in STATIONS:
            snaps = sort_snapshots(by_day[date].get(icao, []))
            stations.append(
                {
                    "icao": icao,
                    "city": cities.get(icao) or STATION_CITY.get(icao, ""),
                    "region": station_region(icao),
                    "snapshots": snaps,
                    "latest": snaps[-1] if snaps else None,
                    "metar": metar_by.get(icao, {}).get(date),
                }
            )
        days.append({"date": date, "stations": stations})
    next_at, next_icao = next_forecast_across_stations()
    return {
        "now": now_paris().isoformat(timespec="seconds"),
        "next_slot": next_at.isoformat(timespec="seconds"),
        "next_slot_icao": next_icao,
        "slots": [s.strftime("%H:%M") for s in SLOTS],
        "stations": summaries,
        "days": days,
    }


class SnapshotHandler(BaseHTTPRequestHandler):
    out_dir: Path

    def log_message(self, fmt: str, *args) -> None:
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
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in ("/", "/index.html"):
            html = DASHBOARD_HTML.read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
            return
        if path == "/api/health":
            self._send_json(200, {"ok": True, "now": now_paris().isoformat(timespec="seconds")})
            return
        if path in ("/api/stations", "/api/by-day"):
            self._send_json(200, dashboard_index(self.out_dir))
            return
        prefix = "/api/stations/"
        if path.startswith(prefix):
            icao = path[len(prefix) :].upper()
            if icao not in STATIONS:
                self._send_json(404, {"error": f"unknown station {icao}"})
                return
            self._send_json(200, load_file(self.out_dir / f"{icao}.json"))
            return
        self._send_json(404, {"error": "not found"})


def start_dashboard(host: str, port: int, out_dir: Path) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (SnapshotHandler,), {"out_dir": out_dir})
    httpd = ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=httpd.serve_forever, name="dashboard", daemon=True)
    thread.start()
    print(f"dashboard http://{host}:{port}", flush=True)
    return httpd


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--loop", action="store_true", help="capture at 06:15/09:15/13:15/14:15 station-local and serve the dashboard")
    p.add_argument("--metar", action="store_true", help="capture today's METAR max now (21h locale job)")
    p.add_argument("--serve", action="store_true", help="serve the dashboard without the capture loop")
    p.add_argument("--host", default="0.0.0.0", help="dashboard bind address")
    p.add_argument("--port", type=int, default=5002, help="dashboard port")
    p.add_argument("--base-url", default=DEFAULT_BASE, help="stations API prefix")
    p.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "data",
        help="directory for {ICAO}.json files",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = args.out_dir if args.out_dir.is_absolute() else ROOT / args.out_dir
    serve = args.loop or args.serve
    httpd = start_dashboard(args.host, args.port, out_dir) if serve else None

    if not args.loop:
        if args.serve:
            threading.Event().wait()
            return 0
        if args.metar:
            return 1 if capture_metar(args.base_url, out_dir, force=True) else 0
        return 1 if capture(args.base_url, out_dir) else 0

    print(
        f"loop station-local {[s.strftime('%H:%M') for s in SLOTS]} + METAR {METAR_SLOT.strftime('%H:%M')} station-local",
        flush=True,
    )
    try:
        while True:
            catch_up_forecast(args.base_url, out_dir)
            catch_up_metar(args.base_url, out_dir)
            nxt, kind, icao = next_event()
            print(f"next {kind} {icao} {nxt.isoformat(timespec='seconds')}", flush=True)
            sleep_until(nxt)
    finally:
        if httpd:
            httpd.shutdown()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
