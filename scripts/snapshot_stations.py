#!/usr/bin/env python3
"""Archive live /api/stations payloads and serve them on a local dashboard.

Default: one capture (cron-friendly).
--loop: capture at 06:00, 09:00, 13:00 Europe/Paris, METAR max at 23:00
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
SLOTS = (dtime(6, 0), dtime(9, 0), dtime(13, 0))
STATIONS = (
    "EDDM",
    "EGLC",
    "LIMC",
    "LFPB",
    "LTAC",
    "EFHK",
    "EPWA",
    "EHAM",
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
    "KHOU": "America/Chicago",
    "KDAL": "America/Chicago",
    "KLGA": "America/New_York",
}
METAR_SLOT = dtime(23, 0)
DEFAULT_BASE = "https://wstation-sepia.vercel.app/api/stations"
METAR_BASE = "https://aviationweather.gov/api/data/metar"
UA = "WStation/0.1 station snapshot"
TIMEOUT_S = 60
RETRIES = 3
DASHBOARD_HTML = Path(__file__).with_name("snapshot_dashboard.html")


def now_paris() -> datetime:
    return datetime.now(PARIS)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def station_zone(icao: str) -> ZoneInfo:
    return ZoneInfo(STATION_TZ[icao])


def local_date(icao: str, instant: datetime | None = None) -> str:
    return (instant or now_utc()).astimezone(station_zone(icao)).date().isoformat()


def slot_label(now: datetime | None = None) -> str:
    local = (now or now_paris()).astimezone(PARIS)
    hhmm = dtime(local.hour, local.minute)
    for slot in SLOTS:
        if hhmm.hour == slot.hour and hhmm.minute < 15:
            return f"{slot.hour:02d}:{slot.minute:02d}"
    return "manual"


def next_forecast_slot(now: datetime | None = None) -> datetime:
    local = (now or now_paris()).astimezone(PARIS)
    for offset in (0, 1):
        day = local.date() + timedelta(days=offset)
        for slot in SLOTS:
            candidate = datetime.combine(day, slot, tzinfo=PARIS)
            if candidate > local + timedelta(seconds=15):
                return candidate
    return datetime.combine(local.date() + timedelta(days=1), SLOTS[0], tzinfo=PARIS)


def next_metar_slot(icao: str, now: datetime | None = None) -> datetime:
    local = (now or now_utc()).astimezone(station_zone(icao))
    for offset in (0, 1, 2):
        day = local.date() + timedelta(days=offset)
        candidate = datetime.combine(day, METAR_SLOT, tzinfo=station_zone(icao))
        if candidate > local + timedelta(seconds=15):
            return candidate
    return datetime.combine(local.date() + timedelta(days=1), METAR_SLOT, tzinfo=station_zone(icao))


def next_event(now: datetime | None = None) -> tuple[datetime, str, str | None]:
    instant = now or now_utc()
    candidates: list[tuple[datetime, str, str | None]] = [
        (next_forecast_slot(instant), "forecast", None)
    ]
    for icao in STATIONS:
        candidates.append((next_metar_slot(icao, instant), "metar", icao))
    return min(candidates, key=lambda row: (row[0], row[1], row[2] or ""))


def http_json(url: str) -> dict:
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
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
            retryable = e.code in (429, 500, 502, 503, 504)
            if retryable and attempt < RETRIES:
                time.sleep(2**attempt)
                continue
            body = e.read()[:300] if e.fp else b""
            raise RuntimeError(f"HTTP {e.code} {body!r}") from e
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


SLOT_RANK = {"06:00": 0, "09:00": 1, "13:00": 2}


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


def snapshot_one(icao: str, base_url: str, out_dir: Path) -> dict:
    url = f"{base_url.rstrip('/')}/{icao}"
    captured_at = now_paris().isoformat(timespec="seconds")
    slot = slot_label()
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


def capture(base_url: str, out_dir: Path) -> int:
    failures = 0
    print(f"{now_paris().isoformat(timespec='seconds')} slot={slot_label()}", flush=True)
    for icao in STATIONS:
        record = snapshot_one(icao, base_url, out_dir)
        if record["ok"]:
            market = (record.get("payload") or {}).get("market_date")
            print(f"  {icao} ok market_date={market}", flush=True)
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


FORECAST_SLOTS = {"06:00", "09:00", "13:00"}


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
        "slot": "23:00",
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
        record["unit"] = payload.get("unit") or "C"
        record["city"] = payload.get("city")
    except Exception as e:
        try:
            record.update(metar_max_from_aw(icao, market_date))
            record["ok"] = True
            record["unit"] = "C"
        except Exception as fallback:
            record["ok"] = False
            record["error"] = f"{e} | fallback: {fallback}"
    upsert_daily_obs(out_dir, icao, record)
    return record


def catch_up_metar(base_url: str, out_dir: Path) -> None:
    now = now_utc()
    for icao in STATIONS:
        local = now.astimezone(station_zone(icao))
        if local.hour < 23:
            continue
        rec = capture_metar_one(icao, base_url, out_dir)
        if rec.get("skipped"):
            if rec.get("reason") == "no-forecast":
                print(f"  {icao} METAR skip {rec.get('date')} (pas de capture 6h/9h/13h)", flush=True)
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
    print(f"{now_paris().isoformat(timespec='seconds')} METAR 23h locale", flush=True)
    for icao in STATIONS:
        rec = capture_metar_one(icao, base_url, out_dir, force=force)
        if rec.get("skipped"):
            reason = rec.get("reason")
            extra = " (pas de capture 6h/9h/13h)" if reason == "no-forecast" else ""
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
        "city": payload.get("city") or data.get("city"),
        "name": payload.get("name"),
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
                    "city": cities.get(icao) or "",
                    "snapshots": snaps,
                    "latest": snaps[-1] if snaps else None,
                    "metar": metar_by.get(icao, {}).get(date),
                }
            )
        days.append({"date": date, "stations": stations})
    return {
        "now": now_paris().isoformat(timespec="seconds"),
        "next_slot": next_forecast_slot().isoformat(timespec="seconds"),
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
    p.add_argument("--loop", action="store_true", help="capture at 06:00/09:00/13:00 Paris and serve the dashboard")
    p.add_argument("--metar", action="store_true", help="capture today's METAR max now (23h locale job)")
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
        f"loop Europe/Paris {[s.strftime('%H:%M') for s in SLOTS]} + METAR 23:00 station-local",
        flush=True,
    )
    try:
        while True:
            catch_up_metar(args.base_url, out_dir)
            nxt, kind, icao = next_event()
            label = f"{kind}" + (f" {icao}" if icao else "")
            print(f"next {label} {nxt.isoformat(timespec='seconds')}", flush=True)
            sleep_until(nxt)
            if kind == "metar" and icao:
                rec = capture_metar_one(icao, args.base_url, out_dir)
                if rec.get("skipped"):
                    reason = rec.get("reason")
                    if reason == "no-forecast":
                        print(f"  {icao} METAR skip {rec.get('date')} (pas de capture 6h/9h/13h)", flush=True)
                    else:
                        print(f"  {icao} METAR already stored {rec.get('date')}", flush=True)
                elif rec.get("ok"):
                    print(
                        f"  {icao} METAR {rec.get('date')} resolved={rec.get('metar_resolution_max_c')}",
                        flush=True,
                    )
                else:
                    print(f"  {icao} METAR FAIL {rec.get('error')}", flush=True)
            else:
                capture(args.base_url, out_dir)
    finally:
        if httpd:
            httpd.shutdown()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
