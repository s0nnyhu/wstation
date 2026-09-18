#!/usr/bin/env python3
"""Fetch resolved Polymarket daily-high buckets and join them onto analysis CSVs.

For each station with `daily_by_run.csv`, pull the city's Gamma series, keep the
bucket whose Yes price settled at 1, write `{ICAO}/polymarket.csv`, and add
`pm_*` columns on every `daily_by_run` row for that local date.

  python3 scripts/archive_polymarket_winners.py
  python3 scripts/archive_polymarket_winners.py --icao EDDM --icao LFPB
  python3 scripts/archive_polymarket_winners.py --join-only
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
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "analysis"
GAMMA = "https://gamma-api.polymarket.com"
UA = "WStation/0.1 polymarket winners archive (non-commercial research)"
HTTP_TIMEOUT_S = 25
PAGE = 100
YES_WIN = 0.99

# Keep in sync with src/config/stations.ts POLYMARKET_CITY.
POLYMARKET_CITY: dict[str, str] = {
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
    "KAUS": "austin",
    "KLGA": "nyc",
    "KSEA": "seattle",
}

MONTHS = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)
MONTH_NUM = {name: i + 1 for i, name in enumerate(MONTHS)}
SLUG_RE = re.compile(
    r"^highest-temperature-in-(.+)-on-("
    + "|".join(MONTHS)
    + r")-(\d{1,2})-(\d{4})$"
)

PM_FIELDS = (
    "icao",
    "date",
    "slug",
    "url",
    "status",
    "closed",
    "winner",
    "unit",
    "winner_c",
    "n_markets",
)
DAILY_BASE = (
    "icao",
    "model",
    "run_utc",
    "date_local",
    "tmax_c",
    "n_hours",
    "init_z",
)
DAILY_PM = (
    "pm_winner",
    "pm_unit",
    "pm_winner_c",
)
DAILY_FIELDS = DAILY_BASE + DAILY_PM


def f_to_c(f: float) -> float:
    return (f - 32.0) * 5.0 / 9.0


def winner_c(lo: int | None, hi: int | None, unit: str | None) -> str:
    if unit not in {"C", "F"}:
        return ""
    if lo is None and hi is None:
        return ""
    if lo is None or hi is None:
        return ""
    mid = (lo + hi) / 2.0
    c = mid if unit == "C" else f_to_c(mid)
    if unit == "C" and lo == hi:
        return str(lo)
    return f"{c:.4f}".rstrip("0").rstrip(".")


def parse_bucket_label(label: str) -> tuple[int | None, int | None, str] | None:
    text = re.sub(r"\s+", " ", label).strip()
    m = re.match(r"^(-?\d+)°([CF]) or below$", text, re.I)
    if m:
        return None, int(m.group(1)), m.group(2).upper()
    m = re.match(r"^(-?\d+)°([CF]) or (?:higher|above)$", text, re.I)
    if m:
        return int(m.group(1)), None, m.group(2).upper()
    m = re.match(r"^(-?\d+)\s?(?:-|–|to)\s?(-?\d+)°([CF])$", text, re.I)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return min(a, b), max(a, b), m.group(3).upper()
    m = re.match(r"^(-?\d+)°([CF])$", text, re.I)
    if m:
        n = int(m.group(1))
        return n, n, m.group(2).upper()
    return None


def date_from_slug(slug: str) -> date | None:
    m = SLUG_RE.match(slug or "")
    if not m:
        return None
    try:
        return date(int(m.group(4)), MONTH_NUM[m.group(2)], int(m.group(3)))
    except ValueError:
        return None


def json_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def yes_price(market: dict[str, Any]) -> float | None:
    outcomes = [str(x) for x in json_list(market.get("outcomes"))]
    prices = json_list(market.get("outcomePrices"))
    idx = next((i for i, o in enumerate(outcomes) if o.lower() == "yes"), 0)
    if idx >= len(prices):
        return None
    try:
        raw = float(prices[idx])
    except (TypeError, ValueError):
        return None
    return raw if raw == raw else None  # NaN check


def http_json(url: str, retries: int, sleep_s: float, timeout: float) -> Any:
    last: Exception | None = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": UA},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            last = e
            retryable = e.code in {429, 500, 502, 503, 504}
            if not retryable or attempt >= retries:
                raise
            wait = min(30.0, sleep_s * (2**attempt) * (5.0 if e.code == 429 else 1.0))
            print(f"  HTTP {e.code} {url} retry in {wait:.1f}s", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            if attempt >= retries:
                raise
            wait = min(20.0, sleep_s * (2**attempt))
            print(f"  net {e} retry in {wait:.1f}s", flush=True)
            time.sleep(wait)
    raise last or RuntimeError(url)


def series_id_for_city(city: str, retries: int, sleep_s: float, timeout: float) -> str:
    slug = f"{city}-daily-weather"
    url = f"{GAMMA}/series?{urllib.parse.urlencode({'slug': slug})}"
    data = http_json(url, retries=retries, sleep_s=sleep_s, timeout=timeout)
    time.sleep(sleep_s)
    if not isinstance(data, list) or not data:
        raise RuntimeError(f"no Gamma series for {slug}")
    sid = data[0].get("id")
    if sid is None or str(sid).strip() == "":
        raise RuntimeError(f"series {slug} has no id")
    return str(sid)


def fetch_series_events(
    series_id: str,
    retries: int,
    sleep_s: float,
    timeout: float,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    offset = 0
    while True:
        q = urllib.parse.urlencode(
            {
                "series_id": series_id,
                "limit": PAGE,
                "offset": offset,
                "order": "id",
                "ascending": "true",
            }
        )
        page = http_json(f"{GAMMA}/events?{q}", retries=retries, sleep_s=sleep_s, timeout=timeout)
        time.sleep(sleep_s)
        if not isinstance(page, list) or not page:
            break
        events.extend(page)
        if len(page) < PAGE:
            break
        offset += len(page)
    return events


def event_row(icao: str, event: dict[str, Any]) -> dict[str, str] | None:
    slug = str(event.get("slug") or "")
    day = date_from_slug(slug)
    if day is None:
        return None
    closed = bool(event.get("closed"))
    markets = event.get("markets") or []
    winners: list[tuple[str, int | None, int | None, str]] = []
    n_parsed = 0
    for market in markets:
        label = str(market.get("groupItemTitle") or "").strip()
        parsed = parse_bucket_label(label)
        if parsed is None:
            continue
        n_parsed += 1
        lo, hi, unit = parsed
        yes = yes_price(market)
        if yes is not None and yes >= YES_WIN:
            winners.append((label, lo, hi, unit))
    if not closed:
        status = "open"
        winner = None
    elif len(winners) == 1:
        status = "resolved"
        winner = winners[0]
    elif len(winners) > 1:
        status = "ambiguous"
        winner = None
    else:
        status = "unresolved"
        winner = None
    label, lo, hi, unit = winner if winner else ("", None, None, None)
    return {
        "icao": icao,
        "date": day.isoformat(),
        "slug": slug,
        "url": f"https://polymarket.com/event/{slug}" if slug else "",
        "status": status,
        "closed": "true" if closed else "false",
        "winner": label,
        "unit": unit or "",
        "winner_c": winner_c(lo, hi, unit) if winner else "",
        "n_markets": str(n_parsed),
    }


def load_pm(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return {}
    with path.open(newline="") as f:
        return {rec["date"]: rec for rec in csv.DictReader(f) if rec.get("date")}


def write_csv(path: Path, fields: tuple[str, ...], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for rec in rows:
            w.writerow({k: rec.get(k, "") for k in fields})
    tmp.replace(path)


def join_daily(daily_path: Path, by_date: dict[str, dict[str, str]]) -> tuple[int, int]:
    if not daily_path.exists() or daily_path.stat().st_size == 0:
        return 0, 0
    with daily_path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    out: list[dict[str, str]] = []
    n_hit = 0
    for rec in rows:
        day = rec.get("date_local") or ""
        pm = by_date.get(day) or {}
        resolved = pm.get("status") == "resolved"
        rec["pm_winner"] = pm.get("winner", "") if resolved else ""
        rec["pm_unit"] = pm.get("unit", "") if resolved else ""
        rec["pm_winner_c"] = pm.get("winner_c", "") if resolved else ""
        if resolved and rec["pm_winner"]:
            n_hit += 1
        out.append(rec)
    write_csv(daily_path, DAILY_FIELDS, out)
    return len(out), n_hit


def analysis_icaos(out: Path) -> list[str]:
    found: list[str] = []
    for path in sorted(out.glob("*/daily_by_run.csv")):
        icao = path.parent.name.upper()
        if icao in POLYMARKET_CITY:
            found.append(icao)
    return found


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--icao", action="append", default=[], help="ICAO (repeatable). Default: stations with daily_by_run.csv")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output directory (default: analysis/)")
    p.add_argument("--sleep", type=float, default=0.25, help="Pause between Gamma requests (seconds)")
    p.add_argument("--timeout", type=float, default=HTTP_TIMEOUT_S)
    p.add_argument("--retries", type=int, default=6)
    p.add_argument(
        "--join-only",
        action="store_true",
        help="Do not hit Gamma; rewrite daily_by_run from existing polymarket.csv",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out = args.out if args.out.is_absolute() else ROOT / args.out
    wanted = [x.strip().upper() for group in args.icao for x in group.split(",") if x.strip()]
    icaos = wanted or analysis_icaos(out)
    if not icaos:
        raise SystemExit(f"no stations under {out}")
    unknown = [x for x in icaos if x not in POLYMARKET_CITY]
    if unknown:
        raise SystemExit(f"no Polymarket city slug for {unknown}")

    print(f"stations={icaos} join_only={args.join_only}", flush=True)
    for icao in icaos:
        city = POLYMARKET_CITY[icao]
        station_dir = out / icao
        pm_path = station_dir / "polymarket.csv"
        daily_path = station_dir / "daily_by_run.csv"
        if args.join_only:
            by_date = load_pm(pm_path)
            n_rows, n_hit = join_daily(daily_path, by_date)
            print(
                f"{icao} join-only polymarket_dates={len(by_date)} "
                f"daily_rows={n_rows} with_winner={n_hit}",
                flush=True,
            )
            continue

        print(f"\n{icao} city={city}", flush=True)
        sid = series_id_for_city(city, args.retries, args.sleep, args.timeout)
        print(f"  series_id={sid}", flush=True)
        events = fetch_series_events(sid, args.retries, args.sleep, args.timeout)
        rows: list[dict[str, str]] = []
        seen: set[str] = set()
        n_resolved = 0
        for event in events:
            rec = event_row(icao, event)
            if rec is None or rec["date"] in seen:
                continue
            seen.add(rec["date"])
            rows.append(rec)
            if rec["status"] == "resolved":
                n_resolved += 1
        rows.sort(key=lambda r: r["date"])
        write_csv(pm_path, PM_FIELDS, rows)
        n_rows, n_hit = join_daily(daily_path, {r["date"]: r for r in rows})
        print(
            f"  events={len(events)} dates={len(rows)} resolved={n_resolved} "
            f"daily_rows={n_rows} with_winner={n_hit} wrote {pm_path}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
