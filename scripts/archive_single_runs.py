#!/usr/bin/env python3
"""Archive Open-Meteo Single Runs for Europe + America stations.

For each station, model, and run initialised on UTC day D, keep hourly
temperature_2m whose valid time falls on the station-local calendar date of
that run (frozen day-J forecast — not a stitched series).

Does not modify the dashboard. No bias / hit-rate.

  python3 scripts/archive_single_runs.py --test
  python3 scripts/archive_single_runs.py --icao EDDM --start 2026-09-14 --end 2026-09-14
  python3 scripts/archive_single_runs.py --start 2026-04-02 --end 2026-09-16
"""

from __future__ import annotations

import argparse
import csv
import json
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
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "analysis"
API = "https://single-runs-api.open-meteo.com/v1/forecast"
UA = "WStation/0.1 single-runs archive (non-commercial research)"
ARCHIVE_START = date(2026, 4, 2)
THREE_HOURLY = (0, 3, 6, 9, 12, 15, 18, 21)
HOURLY = tuple(range(24))
HIGH_FREQ_MODELS = frozenset({"gfs_hrrr"})
UNAVAILABLE_RE = re.compile(r"model run is not available|modelRunUnavailable", re.I)
HTTP_TIMEOUT_S = 25
HOURLY_FIELDS = (
    "icao",
    "model",
    "run_utc",
    "valid_utc",
    "date_local",
    "temperature_2m",
)
DAILY_FIELDS = (
    "icao",
    "model",
    "run_utc",
    "date_local",
    "tmax_c",
    "n_hours",
    "init_z",
    "pm_winner",
    "pm_unit",
    "pm_winner_c",
)

# Keep in sync with src/lib/models.ts
COMPARE_ALL_EUROPE = (
    "icon_seamless",
    "ukmo_seamless",
    "meteofrance_seamless",
    "gem_seamless",
    "knmi_seamless",
    "ecmwf_ifs025",
    "gfs_seamless",
)
COMPARE_ALL_AMERICA = (
    "gfs_hrrr",
    "gfs_seamless",
    "gem_seamless",
    "gem_hrdps_continental",
    "icon_seamless",
    "ecmwf_ifs025",
    "ukmo_seamless",
)

# Prefer a station that actually requests the nest when probing cycles.
PROBE_ICAO = {
    "icon_d2": "EDDM",
    "icon_eu": "EDDM",
    "ukmo_uk_deterministic_2km": "EGLC",
    "meteofrance_arome_france": "LFPB",
    "meteofrance_arome_france_hd": "LFPB",
    "knmi_harmonie_arome_netherlands": "EHAM",
    "knmi_harmonie_arome_europe": "EFHK",
    "gfs_hrrr": "KHOU",
    "gem_hrdps_continental": "KSEA",
}

TEST_JOBS = (
    ("EDDM", ("icon_seamless", "icon_d2")),
    ("KHOU", ("gfs_hrrr", "gfs_seamless")),
)


@dataclass(frozen=True)
class StationSpec:
    icao: str
    name: str
    region: str
    lat: float
    lon: float
    tz: str
    primary: str
    primary_models: tuple[str, ...]
    backups: tuple[str, ...]
    domain_extras: tuple[str, ...] = ()
    short_range: str | None = None

    def models(self) -> list[str]:
        compare = COMPARE_ALL_EUROPE if self.region == "europe" else COMPARE_ALL_AMERICA
        ids: list[str] = []
        for x in (
            *compare,
            self.primary,
            *self.primary_models,
            *([self.short_range] if self.short_range else []),
            *self.backups,
            *self.domain_extras,
        ):
            if x not in ids:
                ids.append(x)
        return ids


# Keep in sync with src/config/stations.ts (europe + america only).
STATIONS: tuple[StationSpec, ...] = (
    StationSpec(
        "EHAM", "Amsterdam Schiphol", "europe", 52.3086, 4.7639, "Europe/Amsterdam",
        "icon_seamless", ("icon_seamless",),
        ("ukmo_seamless", "knmi_seamless"),
        ("knmi_harmonie_arome_netherlands",),
    ),
    StationSpec(
        "LFPB", "Paris Le Bourget", "europe", 48.9694, 2.4414, "Europe/Paris",
        "icon_seamless", ("icon_seamless",),
        (
            "meteofrance_seamless",
            "meteofrance_arome_france",
            "meteofrance_arome_france_hd",
            "ukmo_seamless",
        ),
        ("meteofrance_arome_france", "meteofrance_arome_france_hd"),
    ),
    StationSpec(
        "EDDM", "Munich", "europe", 48.3538, 11.7861, "Europe/Berlin",
        "icon_seamless", ("icon_seamless", "icon_eu"),
        ("icon_eu", "meteofrance_seamless"),
        ("icon_d2", "icon_eu"),
        "icon_d2",
    ),
    StationSpec(
        "EGLC", "London City", "europe", 51.5053, 0.0553, "Europe/London",
        "ukmo_seamless", ("ukmo_seamless",),
        ("icon_seamless",),
        ("ukmo_uk_deterministic_2km",),
        "ukmo_uk_deterministic_2km",
    ),
    StationSpec(
        "LTAC", "Ankara Esenboğa", "europe", 40.1281, 32.9951, "Europe/Istanbul",
        "gem_seamless", ("gem_seamless",),
        ("meteofrance_seamless", "icon_seamless"),
    ),
    StationSpec(
        "LIMC", "Milan Malpensa", "europe", 45.6306, 8.7281, "Europe/Rome",
        "icon_seamless", ("icon_seamless",),
        ("icon_eu", "knmi_seamless", "meteofrance_seamless"),
        ("icon_eu",),
    ),
    StationSpec(
        "EFHK", "Helsinki-Vantaa", "europe", 60.3172, 24.9633, "Europe/Helsinki",
        "knmi_seamless", ("knmi_seamless",),
        ("icon_seamless",),
        ("knmi_harmonie_arome_europe",),
        "knmi_harmonie_arome_europe",
    ),
    StationSpec(
        "EPWA", "Warsaw Chopin", "europe", 52.1657, 20.9671, "Europe/Warsaw",
        "icon_seamless", ("icon_seamless", "icon_eu"),
        ("icon_eu", "knmi_seamless", "gem_seamless"),
        ("icon_eu",),
    ),
    StationSpec(
        "KHOU", "Houston Hobby", "america", 29.6454, -95.2789, "America/Chicago",
        "gfs_seamless", ("gfs_hrrr", "gfs_seamless"),
        ("icon_seamless",),
        ("gfs_hrrr",),
        "gfs_hrrr",
    ),
    StationSpec(
        "KDAL", "Dallas Love Field", "america", 32.8471, -96.8518, "America/Chicago",
        "gfs_seamless", ("gfs_hrrr", "gfs_seamless"),
        ("icon_seamless",),
        ("gfs_hrrr",),
        "gfs_hrrr",
    ),
    StationSpec(
        "KMIA", "Miami", "america", 25.7959, -80.287, "America/New_York",
        "gfs_seamless", ("gfs_hrrr", "gfs_seamless"),
        ("gem_seamless",),
        ("gfs_hrrr",),
        "gfs_hrrr",
    ),
    StationSpec(
        "KAUS", "Austin", "america", 30.1945, -97.6699, "America/Chicago",
        "gem_seamless", ("gfs_hrrr", "gem_seamless", "gfs_seamless"),
        ("icon_seamless",),
        ("gfs_hrrr",),
        "gfs_hrrr",
    ),
    StationSpec(
        "KLGA", "New York LaGuardia", "america", 40.7772, -73.8726, "America/New_York",
        "gfs_seamless", ("gfs_hrrr", "gfs_seamless"),
        ("icon_seamless",),
        ("gfs_hrrr",),
        "gfs_hrrr",
    ),
    StationSpec(
        "KSEA", "Seattle-Tacoma", "america", 47.4502, -122.3088, "America/Los_Angeles",
        "gem_seamless", ("gem_hrdps_continental", "gem_seamless"),
        ("gfs_seamless",),
        ("gem_hrdps_continental",),
        "gem_hrdps_continental",
    ),
)

BY_ICAO = {s.icao: s for s in STATIONS}


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def parse_ymd(s: str) -> date:
    return date.fromisoformat(s)


def flatten(values: list[str]) -> list[str]:
    out: list[str] = []
    for v in values:
        for part in v.split(","):
            p = part.strip()
            if p and p not in out:
                out.append(p)
    return out


def run_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")


def run_param(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00")


def parse_om_time(s: str) -> datetime:
    raw = s.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def local_date(dt: datetime, tz: ZoneInfo) -> date:
    return dt.astimezone(tz).date()


def init_z(dt: datetime) -> str:
    return f"{dt.astimezone(timezone.utc).hour:02d}"


def run_key(icao: str, model: str, run: str) -> str:
    return f"{icao}|{model}|{run}"


class RunUnavailable(Exception):
    def __init__(self, status: int, reason: str, url: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason
        self.url = url


class HttpError(Exception):
    def __init__(self, status: int, reason: str, url: str):
        super().__init__(f"HTTP {status} {reason}")
        self.status = status
        self.reason = reason
        self.url = url


class RateLimiter:
    """Min interval between calls + extra cooldown after 429."""

    def __init__(self, min_interval: float):
        self.min_interval = max(0.0, min_interval)
        self.cooldown = 0.0
        self.n_429 = 0
        self._last = 0.0

    def wait(self) -> None:
        gap = self.min_interval + self.cooldown
        if self._last:
            elapsed = time.monotonic() - self._last
            if elapsed < gap:
                time.sleep(gap - elapsed)
        self._last = time.monotonic()
        if self.cooldown > 0:
            self.cooldown = max(0.0, self.cooldown - self.min_interval * 0.2)

    def on_success(self) -> None:
        self.cooldown *= 0.85
        if self.cooldown < 0.05:
            self.cooldown = 0.0

    def on_429(self, retry_after: float | None) -> None:
        self.n_429 += 1
        if retry_after and retry_after > 0:
            wait = min(300.0, retry_after)
        else:
            wait = min(300.0, 20.0 * (2 ** min(self.n_429 - 1, 3)))
        wait = max(wait, 15.0)
        self.cooldown = max(self.cooldown, min(90.0, wait / 2.0))
        print(
            f"  HTTP 429 too many requests — sleep {wait:.0f}s "
            f"(cooldown {self.cooldown:.1f}s, n_429={self.n_429})",
            flush=True,
        )
        time.sleep(wait)


def parse_retry_after(headers) -> float | None:
    if not headers:
        return None
    raw = headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def as_text(raw) -> str:
    if isinstance(raw, (bytes, bytearray)):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


def http_json(
    url: str,
    *,
    retries: int,
    limiter: RateLimiter,
    log,
    meta: dict,
    timeout: float = HTTP_TIMEOUT_S,
) -> dict:
    last: Exception | None = None
    parse_fail = 0
    for attempt in range(retries + 1):
        limiter.wait()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                status = res.status
                raw = res.read()
            text = as_text(raw)
            if UNAVAILABLE_RE.search(text):
                reason = text.strip().replace("\n", " ")[:500]
                log({**meta, "url": url, "status": status, "action": "skip", "reason": reason})
                raise RunUnavailable(status, reason, url)
            if not text.strip():
                raise ValueError("empty body")
            try:
                data = json.loads(text)
            except json.JSONDecodeError as e:
                raise ValueError(f"non-json body: {text[:120]!r}") from e
            if data.get("error"):
                reason = str(data.get("reason") or "error")
                if UNAVAILABLE_RE.search(reason):
                    log({**meta, "url": url, "status": status, "action": "skip", "reason": reason})
                    raise RunUnavailable(status, reason, url)
                raise HttpError(status, reason, url)
            limiter.on_success()
            log({**meta, "url": url, "status": status, "action": "ok"})
            return data
        except RunUnavailable:
            raise
        except HttpError as e:
            last = e
            if e.status in (429, 500, 502, 503, 504) and attempt < retries:
                if e.status == 429:
                    limiter.on_429(None)
                else:
                    time.sleep(min(30.0, 2 ** attempt))
                continue
            log({**meta, "url": url, "status": e.status, "action": "error", "reason": e.reason})
            raise
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            reason = body
            try:
                parsed = json.loads(body) if body else {}
                reason = str(parsed.get("reason") or body)
            except json.JSONDecodeError:
                parsed = {}
            if UNAVAILABLE_RE.search(body) or UNAVAILABLE_RE.search(reason):
                log({**meta, "url": url, "status": e.code, "action": "skip", "reason": reason[:500]})
                raise RunUnavailable(e.code, reason[:500], url) from e
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                last = e
                if e.code == 429:
                    limiter.on_429(parse_retry_after(e.headers))
                else:
                    time.sleep(min(30.0, 2 ** attempt))
                continue
            log({
                **meta,
                "url": url,
                "status": e.code,
                "action": "error",
                "reason": reason[:500],
            })
            raise HttpError(e.code, reason[:500], url) from e
        except Exception as e:
            last = e
            parse_fail += 1
            if parse_fail <= 1 and attempt < retries:
                time.sleep(2.0)
                continue
            log({**meta, "url": url, "status": None, "action": "error", "reason": str(e)[:500]})
            raise
    raise RuntimeError(str(last))


def forecast_url(st: StationSpec, model: str, run: datetime, forecast_days: int) -> str:
    qs = urllib.parse.urlencode(
        {
            "latitude": st.lat,
            "longitude": st.lon,
            "models": model,
            "run": run_param(run),
            "hourly": "temperature_2m",
            "timezone": "UTC",
            "forecast_days": forecast_days,
            "temperature_unit": "celsius",
        }
    )
    return f"{API}?{qs}"


def temp_series(hourly: dict) -> list:
    if "temperature_2m" in hourly:
        return hourly["temperature_2m"]
    for key, val in hourly.items():
        if key.startswith("temperature_2m"):
            return val
    return []


def extract_day_j(
    data: dict,
    run: datetime,
    tz: ZoneInfo,
) -> tuple[list[tuple[datetime, float]], date]:
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    temps = temp_series(hourly)
    day = local_date(run, tz)
    rows: list[tuple[datetime, float]] = []
    for t_raw, v in zip(times, temps):
        if v is None or t_raw is None:
            continue
        try:
            valid = parse_om_time(str(t_raw))
            val = float(v)
        except (TypeError, ValueError):
            continue
        if valid < run:
            continue
        if local_date(valid, tz) != day:
            continue
        rows.append((valid, val))
    return rows, day


def load_existing_runs(path: Path) -> set[str]:
    keys: set[str] = set()
    if not path.exists() or path.stat().st_size == 0:
        return keys
    with path.open(newline="") as f:
        for rec in csv.DictReader(f):
            keys.add(run_key(rec["icao"], rec["model"], rec["run_utc"]))
    return keys


def load_unavailable(path: Path, retry_after: date) -> set[str]:
    keys: set[str] = set()
    if not path.exists():
        return keys
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            reason = str(rec.get("reason") or "")
            if rec.get("action") != "skip" and not UNAVAILABLE_RE.search(reason):
                continue
            icao, model, run = rec.get("icao"), rec.get("model"), rec.get("run")
            if not (icao and model and run):
                continue
            try:
                run_d = parse_om_time(run).date()
            except ValueError:
                continue
            if run_d >= retry_after:
                continue
            keys.add(run_key(icao, model, run if run.endswith("Z") else run_iso(parse_om_time(run))))
    return keys


class JsonlLog:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = path.open("a")

    def __call__(self, rec: dict) -> None:
        rec = {"ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **rec}
        self._fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


def load_pm_by_date(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return {}
    out: dict[str, dict[str, str]] = {}
    with path.open(newline="") as f:
        for rec in csv.DictReader(f):
            day = rec.get("date") or ""
            if day and rec.get("status") == "resolved":
                out[day] = rec
    return out


def pm_columns(pm: dict[str, str] | None) -> dict[str, str]:
    if not pm:
        return {k: "" for k in ("pm_winner", "pm_unit", "pm_winner_c")}
    return {
        "pm_winner": pm.get("winner", ""),
        "pm_unit": pm.get("unit", ""),
        "pm_winner_c": pm.get("winner_c", ""),
    }


class CsvSink:
    def __init__(self, directory: Path):
        self.directory = directory
        self._hourly: dict[str, tuple] = {}
        self._daily: dict[str, tuple] = {}
        self.daily_keys: dict[str, set[str]] = {}
        self.hourly_keys: dict[str, set[str]] = {}
        self._pm: dict[str, dict[str, dict[str, str]]] = {}

    def _open(self, icao: str) -> None:
        if icao in self._daily:
            return
        d = self.directory / icao
        d.mkdir(parents=True, exist_ok=True)
        hourly_path = d / "hourly.csv"
        daily_path = d / "daily_by_run.csv"
        self.hourly_keys[icao] = load_existing_runs(hourly_path)
        self.daily_keys[icao] = load_existing_runs(daily_path)
        self._pm[icao] = load_pm_by_date(d / "polymarket.csv")
        hf = hourly_path.open("a", newline="")
        df = daily_path.open("a", newline="")
        hw = csv.DictWriter(hf, fieldnames=HOURLY_FIELDS)
        dw = csv.DictWriter(df, fieldnames=DAILY_FIELDS)
        if hourly_path.stat().st_size == 0:
            hw.writeheader()
        if daily_path.stat().st_size == 0:
            dw.writeheader()
        self._hourly[icao] = (hf, hw)
        self._daily[icao] = (df, dw)

    def has_run(self, icao: str, model: str, run: str) -> bool:
        self._open(icao)
        return run_key(icao, model, run) in self.daily_keys[icao]

    def write_run(
        self,
        icao: str,
        model: str,
        run: datetime,
        day: date,
        hours: list[tuple[datetime, float]],
    ) -> None:
        self._open(icao)
        run_s = run_iso(run)
        key = run_key(icao, model, run_s)
        hf, hw = self._hourly[icao]
        df, dw = self._daily[icao]
        if key not in self.hourly_keys[icao]:
            for valid, temp in hours:
                hw.writerow(
                    {
                        "icao": icao,
                        "model": model,
                        "run_utc": run_s,
                        "valid_utc": run_iso(valid),
                        "date_local": day.isoformat(),
                        "temperature_2m": temp,
                    }
                )
            hf.flush()
            self.hourly_keys[icao].add(key)
        if key in self.daily_keys[icao]:
            return
        tmax = max((t for _, t in hours), default=None)
        dw.writerow(
            {
                "icao": icao,
                "model": model,
                "run_utc": run_s,
                "date_local": day.isoformat(),
                "tmax_c": "" if tmax is None else tmax,
                "n_hours": len(hours),
                "init_z": init_z(run),
                **pm_columns(self._pm.get(icao, {}).get(day.isoformat())),
            }
        )
        df.flush()
        self.daily_keys[icao].add(key)

    def close(self) -> None:
        for hf, _ in self._hourly.values():
            hf.close()
        for df, _ in self._daily.values():
            df.close()


def load_cycles(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def save_cycles(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def probe_station_for(model: str, jobs: list[tuple[StationSpec, list[str]]]) -> StationSpec:
    prefer = PROBE_ICAO.get(model)
    if prefer and prefer in BY_ICAO:
        st = BY_ICAO[prefer]
        if model in st.models():
            return st
    for st, models in jobs:
        if model in models:
            return st
    for st in STATIONS:
        if model in st.models():
            return st
    raise SystemExit(f"no station to probe model {model}")


def probe_hour(
    st: StationSpec,
    model: str,
    day: date,
    hour: int,
    *,
    retries: int,
    limiter: RateLimiter,
    log,
) -> bool:
    run = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
    url = forecast_url(st, model, run, forecast_days=1)
    try:
        http_json(
            url,
            retries=retries,
            limiter=limiter,
            log=log,
            meta={"phase": "probe", "icao": st.icao, "model": model, "run": run_iso(run)},
        )
        return True
    except RunUnavailable:
        return False


def probe_dates(probe_day: date, n_days: int) -> list[date]:
    n = max(1, n_days)
    dates = [probe_day - timedelta(days=i) for i in range(n)]
    return [d for d in dates if d >= ARCHIVE_START]


def ensure_cycles(
    *,
    models: list[str],
    jobs: list[tuple[StationSpec, list[str]]],
    path: Path,
    probe_day: date,
    probe_days: int,
    reprobe: bool,
    retries: int,
    limiter: RateLimiter,
    log,
) -> dict[str, list[int]]:
    payload = load_cycles(path)
    stored = payload.get("models") or {}
    hours_by_model: dict[str, list[int]] = {}
    changed = False
    days = probe_dates(probe_day, probe_days)
    for model in models:
        prev = stored.get(model) or {}
        prev_hours = prev.get("hours_utc")
        if prev_hours and not reprobe:
            hours_by_model[model] = [int(h) for h in prev_hours]
            continue
        st = probe_station_for(model, jobs)
        tried = list(THREE_HOURLY)
        if model in HIGH_FREQ_MODELS:
            tried = list(HOURLY)
        print(
            f"probe {model} @ {st.icao} days={[d.isoformat() for d in days]} hours={tried}",
            flush=True,
        )
        ok: list[int] = []
        by_day: dict[str, list[int]] = {}
        for hour in tried:
            found_on: str | None = None
            for day in days:
                if probe_hour(st, model, day, hour, retries=retries, limiter=limiter, log=log):
                    found_on = day.isoformat()
                    by_day.setdefault(day.isoformat(), []).append(hour)
                    break
            if found_on:
                ok.append(hour)
                extra = f" (ok {found_on})" if found_on != days[0].isoformat() else ""
                print(f"  {hour:02d}z ok{extra}", flush=True)
            else:
                print(f"  {hour:02d}z skip", flush=True)
        hours_by_model[model] = ok
        stored[model] = {
            "hours_utc": ok,
            "probe_icao": st.icao,
            "probe_dates": [d.isoformat() for d in days],
            "ok_by_day": by_day,
            "n_ok": len(ok),
            "n_tried": len(tried),
        }
        changed = True
        if not ok:
            print(f"  WARN {model}: no cycles on {days}", flush=True)
    if changed or not payload:
        payload = {
            "api": API,
            "archive_start": ARCHIVE_START.isoformat(),
            "probe_date": probe_day.isoformat(),
            "probe_dates": [d.isoformat() for d in days],
            "probed_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "candidate_hours": list(THREE_HOURLY),
            "hourly_probe_models": sorted(HIGH_FREQ_MODELS),
            "note": (
                "Hours that returned HTTP 200 on at least one probe date (union). "
                "A single missing run is not treated as 'this cycle never exists'. "
                "gfs_hrrr is probed hourly; others 00/03/06/09/12/15/18/21. "
                "Fetch still skips a calendar day whose run is unavailable - no invented fallback."
            ),
            "models": stored,
        }
        save_cycles(path, payload)
        print(f"wrote {path}", flush=True)
    return hours_by_model


def daterange(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--icao", action="append", default=[], help="ICAO (repeatable / comma-separated). Default: all EU+US")
    p.add_argument("--start", default=ARCHIVE_START.isoformat(), help="UTC start date (inclusive)")
    p.add_argument("--end", default=None, help="UTC end date (inclusive). Default: today UTC")
    p.add_argument("--models", action="append", default=[], help="Restrict models (repeatable). Default: station union")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output directory (default: analysis/)")
    p.add_argument("--sleep", type=float, default=0.7, help="Min pause between HTTP requests (seconds)")
    p.add_argument("--timeout", type=float, default=HTTP_TIMEOUT_S, help="HTTP timeout per request (seconds)")
    p.add_argument("--retries", type=int, default=8, help="Retries on 429/5xx/network")
    p.add_argument("--forecast-days", type=int, default=2, help="forecast_days (must cover rest of local day)")
    p.add_argument("--probe-day", default=None, help="Latest UTC date used to discover run cycles")
    p.add_argument(
        "--probe-days",
        type=int,
        default=3,
        help="How many recent UTC days to union when discovering cycles (covers one-day archive holes)",
    )
    p.add_argument("--reprobe", action="store_true", help="Re-probe run cycles even if run_cycles.json exists")
    p.add_argument(
        "--test",
        action="store_true",
        help="1-day smoke test: EDDM icon_seamless+icon_d2, KHOU gfs_hrrr+gfs_seamless",
    )
    p.add_argument("--probe-only", action="store_true", help="Discover cycles and exit")
    return p.parse_args(argv)


def jobs_from_args(args: argparse.Namespace) -> list[tuple[StationSpec, list[str]]]:
    if args.test:
        jobs = []
        for icao, models in TEST_JOBS:
            st = BY_ICAO[icao]
            allowed = set(st.models())
            picked = [m for m in models if m in allowed]
            missing = [m for m in models if m not in allowed]
            if missing:
                raise SystemExit(f"{icao}: test models not in union: {missing}")
            jobs.append((st, picked))
        return jobs
    wanted_icao = [x.upper() for x in flatten(args.icao)]
    if wanted_icao:
        unknown = [x for x in wanted_icao if x not in BY_ICAO]
        if unknown:
            raise SystemExit(f"unknown ICAO {unknown}; known: {', '.join(BY_ICAO)}")
        stations = [BY_ICAO[x] for x in wanted_icao]
    else:
        stations = list(STATIONS)
    wanted_models = flatten(args.models)
    jobs = []
    for st in stations:
        models = st.models()
        if wanted_models:
            models = [m for m in models if m in wanted_models]
        if not models:
            print(f"skip {st.icao}: no models after --models filter", flush=True)
            continue
        jobs.append((st, models))
    return jobs


def print_runs_per_day(sink: CsvSink, start: date, end: date) -> None:
    print("\nruns/day in window "
          f"{start.isoformat()} → {end.isoformat()} (successful daily_by_run rows):", flush=True)
    n_days = (end - start).days + 1
    for icao, keys in sink.daily_keys.items():
        by_model: dict[str, list[str]] = defaultdict(list)
        for key in sorted(keys):
            _, model, run = key.split("|", 2)
            run_d = parse_om_time(run).date()
            if start <= run_d <= end:
                by_model[model].append(run)
        if not by_model:
            print(f"  {icao}: no rows", flush=True)
            continue
        for model, runs in by_model.items():
            hours = sorted({parse_om_time(r).hour for r in runs})
            per_day = len(runs) / n_days if n_days else 0
            zlist = ",".join(f"{h:02d}" for h in hours)
            print(
                f"  {icao} {model}: {len(runs)} runs / {n_days} day(s) "
                f"({per_day:.1f}/day) init_z={zlist}",
                flush=True,
            )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    start = parse_ymd(args.start)
    end = parse_ymd(args.end) if args.end else utc_today()
    if args.test and args.end is None and args.start == ARCHIVE_START.isoformat():
        end = utc_today() - timedelta(days=2)
        start = end
    if start < ARCHIVE_START:
        print(f"note: archive starts {ARCHIVE_START.isoformat()}; clipping --start", flush=True)
        start = ARCHIVE_START
    if end < start:
        raise SystemExit("--end must be >= --start")
    now = datetime.now(timezone.utc)
    out = args.out if args.out.is_absolute() else ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    jobs = jobs_from_args(args)
    if not jobs:
        raise SystemExit("no station/model jobs")
    models = []
    for _, ms in jobs:
        for m in ms:
            if m not in models:
                models.append(m)
    probe_day = parse_ymd(args.probe_day) if args.probe_day else min(end, utc_today() - timedelta(days=2))
    if probe_day < ARCHIVE_START:
        probe_day = ARCHIVE_START
    retry_after = utc_today() - timedelta(days=2)
    unavailable = load_unavailable(out / "fetch_log.jsonl", retry_after)
    log = JsonlLog(out / "fetch_log.jsonl")
    sink = CsvSink(out)
    limiter = RateLimiter(args.sleep)
    print(
        f"stations={[st.icao for st, _ in jobs]} {start}→{end} "
        f"sleep={args.sleep}s retries={args.retries}",
        flush=True,
    )
    try:
        cycles = ensure_cycles(
            models=models,
            jobs=jobs,
            path=out / "run_cycles.json",
            probe_day=probe_day,
            probe_days=args.probe_days,
            reprobe=args.reprobe,
            retries=args.retries,
            limiter=limiter,
            log=log,
        )
        if args.probe_only:
            return 0
        stats = defaultdict(int)
        for st, st_models in jobs:
            tz = ZoneInfo(st.tz)
            print(f"\n{st.icao} models={','.join(st_models)} {start}→{end}", flush=True)
            for model in st_models:
                hours = cycles.get(model) or []
                if not hours:
                    print(f"  skip {model}: no probed cycles", flush=True)
                    continue
                consecutive_err = 0
                model_cache = 0
                print(f"  {model} cycles={len(hours)}", flush=True)
                for day in daterange(start, end):
                    for hour in hours:
                        run = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
                        if run > now:
                            stats["future"] += 1
                            continue
                        run_s = run_iso(run)
                        key = run_key(st.icao, model, run_s)
                        if sink.has_run(st.icao, model, run_s):
                            stats["cache"] += 1
                            model_cache += 1
                            if model_cache % 200 == 0:
                                print(f"  {model} cache_hits={model_cache}", flush=True)
                            continue
                        if key in unavailable:
                            stats["skip_cached"] += 1
                            continue
                        url = forecast_url(st, model, run, args.forecast_days)
                        meta = {
                            "phase": "fetch",
                            "icao": st.icao,
                            "model": model,
                            "run": run_s,
                        }
                        try:
                            data = http_json(
                                url,
                                retries=args.retries,
                                limiter=limiter,
                                log=log,
                                meta=meta,
                                timeout=args.timeout,
                            )
                        except RunUnavailable:
                            stats["skip"] += 1
                            consecutive_err = 0
                            print(f"  {model} {run_s} skip (run unavailable)", flush=True)
                            continue
                        except HttpError as e:
                            stats["error"] += 1
                            if e.status == 429:
                                stats["rate_limit"] += 1
                                consecutive_err = 0
                                print(f"  {model} {run_s} still 429 after retries, continue", flush=True)
                                continue
                            consecutive_err += 1
                            print(f"  {model} {run_s} error {e}", flush=True)
                            if consecutive_err >= 5:
                                cool = min(30.0, 5.0 * consecutive_err)
                                print(
                                    f"  {st.icao} {model}: {consecutive_err} consecutive errors, "
                                    f"cool {cool:.0f}s then continue",
                                    flush=True,
                                )
                                time.sleep(cool)
                            continue
                        except Exception as e:
                            stats["error"] += 1
                            consecutive_err += 1
                            print(f"  {model} {run_s} error {e}", flush=True)
                            if consecutive_err >= 5:
                                cool = min(30.0, 5.0 * consecutive_err)
                                print(
                                    f"  {st.icao} {model}: {consecutive_err} consecutive errors, "
                                    f"cool {cool:.0f}s then continue",
                                    flush=True,
                                )
                                time.sleep(cool)
                            continue
                        consecutive_err = 0
                        hours_rows, date_local = extract_day_j(data, run, tz)
                        sink.write_run(st.icao, model, run, date_local, hours_rows)
                        tmax = max((t for _, t in hours_rows), default=None)
                        stats["ok"] += 1
                        print(
                            f"  {model} {run_s} ok n_hours={len(hours_rows)} "
                            f"date_local={date_local} tmax_c={tmax}",
                            flush=True,
                        )
        print(
            "\nsummary "
            f"ok={stats['ok']} cache={stats['cache']} skip={stats['skip']} "
            f"skip_cached={stats['skip_cached']} error={stats['error']} "
            f"rate_limit={stats['rate_limit']} future={stats['future']} "
            f"n_429={limiter.n_429}",
            flush=True,
        )
        print_runs_per_day(sink, start, end)
        return 0
    finally:
        sink.close()
        log.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
