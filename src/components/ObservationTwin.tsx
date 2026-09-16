"use client";

import { ageLabel, fetchedAtMs, localHourLabel } from "@/lib/time";
import type { StationPayload, TempUnit } from "@/lib/types";
import { convertDelta, formatMetarWind, formatTemp } from "@/lib/units";
import { useEffect, useState } from "react";
import { HourlyIconStrip } from "./HourlyIconStrip";
import { LocalClock } from "./LocalClock";
import { OutLink } from "./OutLink";
import { WeatherIcon } from "./WeatherIcon";

function formatWuWind(
  kmh: number | null | undefined,
  dir: number | null | undefined,
  unit: TempUnit,
): string {
  if (kmh == null) return "—";
  const heading = dir == null ? "" : `${Math.round(dir)}° `;
  if (unit === "F") {
    return `${heading}${Math.round(kmh * 0.621371)} mph`;
  }
  return `${heading}${Math.round(kmh * 0.539957)} kt`;
}

function formatPressure(hPa: number | null | undefined): string {
  if (hPa == null) return "—";
  return `${Math.round(hPa)} hPa`;
}

function formatHumidity(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

function formatDelta(deltaC: number, unit: TempUnit): string {
  const d = convertDelta(deltaC, unit);
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}°`;
}

function conditionLine(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p && p !== "—" ? p : "—")).join(" · ");
}

export function ObservationTwin({
  data,
  unit,
}: {
  data: StationPayload;
  unit: TempUnit;
}) {
  const { wu, metar, station, day } = data;
  const icao = wu.stationId ?? station.icao;
  const [now, setNow] = useState(() => fetchedAtMs(metar.fetchedAt) ?? 0);
  const [rawOpen, setRawOpen] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const wuHigh = wu.ok ? (wu.predictedHighC ?? wu.dailyMaxC ?? null) : null;
  const wuCurrent = wu.ok ? (wu.currentTempC ?? null) : null;
  const metarHigh = day === "today" ? (metar.runningMaxC ?? null) : null;
  const metarNow = metar.ok ? (metar.latest?.tempC ?? null) : null;

  const deltaNow =
    wuCurrent != null && metarNow != null ? wuCurrent - metarNow : null;
  const deltaHigh =
    wuHigh != null && metarHigh != null ? wuHigh - metarHigh : null;

  const wuHourly = (wu.hourly ?? []).map((h) => ({
    key: h.time,
    hour: h.localHour,
    tempC: h.tempC,
    precipProb: h.precipProb,
    icon: h.icon,
    label: h.condition,
  }));

  const metarHourly =
    day === "today"
      ? (metar.observations ?? []).map((o) => ({
          key: o.at,
          hour: new Intl.DateTimeFormat("en-GB", {
            timeZone: station.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(new Date(o.at)),
          tempC: o.tempC,
          icon: o.icon,
          label: o.sky ?? undefined,
        }))
      : [];

  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">
          Observations · Resolution
        </h2>
        <span className="rounded-md border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan">
          WU · Polymarket resolution
        </span>
        <span className="rounded-md border border-teal/40 bg-teal/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-teal">
          METAR · aviation cross-check
        </span>
        {deltaNow != null && (
          <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tabular text-ink">
            WU−METAR now {formatDelta(deltaNow, unit)}
          </span>
        )}
        {deltaHigh != null && (
          <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tabular text-amber">
            WU−METAR high {formatDelta(deltaHigh, unit)}
          </span>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <article className="panel min-w-0 overflow-hidden border-l-2 border-l-cyan p-3 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-cyan sm:tracking-[0.16em]">
                Weather Underground ({icao})
              </h3>
              {wu.stale && (
                <div className="mt-0.5 text-[10px] text-warn">stale cache</div>
              )}
            </div>
            <div className="shrink-0 text-xs">
              <LocalClock timezone={station.timezone} compact />
            </div>
          </div>

          {!wu.ok && (
            <p className="mt-4 text-sm text-bad">
              WU unavailable{wu.error ? ` · ${wu.error}` : ""}
            </p>
          )}

          {wu.ok && (
            <>
              <div className="mt-4 flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-end min-[400px]:justify-between min-[400px]:gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
                    {day === "tomorrow" ? "Forecast high" : "Predicted high"}
                  </div>
                  <div className="mt-1 font-mono text-3xl tabular text-amber sm:text-4xl">
                    {formatTemp(wuHigh, unit, 1)}
                  </div>
                  {wu.lowC != null && (
                    <div className="mt-0.5 text-xs text-mute">
                      Low {formatTemp(wu.lowC, unit, 1)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 min-[400px]:text-right">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
                    Current
                  </div>
                  <div className="mt-1 flex items-center gap-2 min-[400px]:justify-end">
                    {wu.icon && (
                      <WeatherIcon
                        kind={wu.icon}
                        className="h-6 w-6 shrink-0 text-cyan sm:h-7 sm:w-7"
                        title={wu.condition ?? undefined}
                      />
                    )}
                    <div className="font-mono text-3xl tabular text-cyan sm:text-4xl lg:text-5xl">
                      {formatTemp(wuCurrent, unit, 1)}
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs italic leading-relaxed text-mute">
                Live WU current is not the settled daily max. Polymarket
                typically resolves from the WU daily archive after the local day
                closes.
              </p>
              <p className="mt-2 break-words text-xs text-mute">
                {conditionLine([
                  wu.condition,
                  formatWuWind(wu.windKmh, wu.windDirDeg, unit),
                  formatHumidity(wu.humidityPct),
                  formatPressure(wu.pressureHPa),
                ])}
              </p>
              <HourlyIconStrip
                items={wuHourly}
                unit={unit}
                showPrecip
                empty={
                  wu.error
                    ? `WU hourly unavailable · ${wu.error}`
                    : "WU hourly unavailable"
                }
              />
              {wu.forecastUrl && (
                <div className="mt-3">
                  <OutLink href={wu.forecastUrl}>WU forecast page</OutLink>
                </div>
              )}
            </>
          )}
        </article>

        <article className="panel min-w-0 overflow-hidden border-l-2 border-l-teal p-3 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-teal sm:tracking-[0.16em]">
                METAR station ({station.icao})
              </h3>
              {metar.stale && (
                <div className="mt-0.5 text-[10px] text-warn">stale cache</div>
              )}
            </div>
            <div className="shrink-0 font-mono text-xs tabular text-mute">
              {ageLabel(metar.latest?.observedAt, now)}
            </div>
          </div>

          {!metar.ok && (
            <p className="mt-4 text-sm text-bad">
              {metar.error ?? `No METAR for ${station.icao}`}
            </p>
          )}

          {metar.ok && metar.latest && (
            <>
              <div className="mt-4 flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-end min-[400px]:justify-between min-[400px]:gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
                    Today&apos;s high
                  </div>
                  <div className="mt-1 font-mono text-3xl tabular text-amber sm:text-4xl">
                    {day === "today" ? formatTemp(metarHigh, unit, 1) : "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-mute">
                    {day === "tomorrow"
                      ? "not started"
                      : metarHigh == null
                        ? "no METAR yet today"
                        : metar.runningMaxAt
                          ? localHourLabel(
                              new Intl.DateTimeFormat("en-GB", {
                                timeZone: station.timezone,
                                hour: "2-digit",
                                minute: "2-digit",
                                hourCycle: "h23",
                              }).format(new Date(metar.runningMaxAt)),
                            )
                          : "running max"}
                  </div>
                </div>
                <div className="min-w-0 min-[400px]:text-right">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
                    Current
                  </div>
                  <div className="mt-1 flex items-center gap-2 min-[400px]:justify-end">
                    {metar.latest.icon && (
                      <WeatherIcon
                        kind={metar.latest.icon}
                        className="h-6 w-6 shrink-0 text-teal sm:h-7 sm:w-7"
                        title={metar.latest.sky ?? undefined}
                      />
                    )}
                    <div className="font-mono text-3xl tabular text-teal sm:text-4xl lg:text-5xl">
                      {formatTemp(metarNow, unit, 1)}
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-3 break-words text-xs text-mute">
                {conditionLine([
                  metar.latest.sky ?? "sky —",
                  formatMetarWind(
                    metar.latest.windDirDeg,
                    metar.latest.windSpeedKt,
                    metar.latest.windGustKt,
                  ),
                  formatHumidity(metar.latest.humidityPct),
                  formatPressure(metar.latest.altimeterHPa),
                ])}
              </p>
              <HourlyIconStrip
                items={metarHourly}
                unit={unit}
                empty={
                  day === "tomorrow"
                    ? "Tomorrow not started"
                    : "No METAR observations for this local day"
                }
              />
              {metar.latest.raw && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setRawOpen((v) => !v)}
                    className="text-[11px] uppercase tracking-[0.14em] text-teal hover:underline"
                  >
                    {rawOpen ? "Hide raw METAR" : "Raw METAR"}
                  </button>
                  {rawOpen && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-mute">
                      {metar.latest.raw}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
