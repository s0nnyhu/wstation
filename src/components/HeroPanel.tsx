"use client";

import { REGION_LABEL } from "@/config/stations";
import { LEAD_LABEL } from "@/lib/ensemble";
import { describeMetar } from "@/lib/metarDecode";
import { zonedHhMm } from "@/lib/time";
import type { TrendPayload, TrendReason } from "@/lib/trend";
import type { MarketDay, StationPayload, TempUnit } from "@/lib/types";
import { convertDelta, formatTemp } from "@/lib/units";
import { LocalClock } from "./LocalClock";
import { OutLink } from "./OutLink";
import { WeatherIcon } from "./WeatherIcon";

function formatPeak(time: string | undefined): string {
  if (!time) return "—";
  return time.includes("T") ? time.slice(11, 16) : time;
}

const TREND_LABEL: Record<TrendPayload["state"], { icon: string; text: string; tone: string }> = {
  warming: { icon: "↗", text: "Still warming", tone: "text-hot" },
  holding: { icon: "→", text: "Holding", tone: "text-ink" },
  cooling: { icon: "↘", text: "Cooling", tone: "text-cyan" },
  unstable: { icon: "⚠", text: "Unstable", tone: "text-warn" },
};

function formatDelta(deltaC: number, unit: TempUnit): string {
  const v = convertDelta(deltaC, unit);
  if (Math.abs(v) < 0.05) return `±0.0°${unit}`;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}°${unit}`;
}

function reasonText(r: TrendReason, unit: TempUnit): string {
  switch (r.kind) {
    case "split":
      return `models split ${formatTemp(r.loC, unit, 1)}–${formatTemp(r.hiC, unit, 1)} at ${r.at}`;
    case "convective-now":
      return "showers or thunder at the airport";
    case "convective-soon":
      return `showers likely ~${r.at}${r.prob != null ? ` (${r.prob}%)` : ""}`;
    case "jump":
      return `jumped ${formatDelta(r.deltaC, unit)} in ${r.minutes} min`;
    case "contradiction":
      return "observations going against the models";
  }
}

/** One line: label, then the evidence behind it. */
function trendParts(t: TrendPayload, unit: TempUnit): string[] {
  const parts: string[] = [];
  if (t.state === "unstable") parts.push(...t.reasons.map((r) => reasonText(r, unit)));
  if (t.changeC != null && t.horizon) {
    parts.push(`models ${formatDelta(t.changeC, unit)} by ${t.horizon} (${t.agree}/${t.families} agree)`);
  }
  if (t.obsSlopeCPerH != null) parts.push(`observed ${formatDelta(t.obsSlopeCPerH, unit)}/h`);
  if (t.peakAt) parts.push(`peak ~${t.peakAt}`);
  else if (t.peakPassed) parts.push("peak passed");
  if (t.state !== "unstable" && t.upsideVsMaxC != null) {
    if (t.upsideVsMaxC >= 0.3) parts.push(`could beat today's max by ${formatDelta(t.upsideVsMaxC, unit)}`);
    else if (t.peakPassed) parts.push("today's max likely set");
  }
  if (t.state !== "unstable" && t.confidence === "low") parts.push("low confidence");
  return parts;
}

export function HeroPanel({
  data,
  unit,
  day,
  onDay,
}: {
  data: StationPayload;
  unit: TempUnit;
  day: MarketDay;
  onDay: (day: MarketDay) => void;
}) {
  const ens = data.forecast.ensemble;
  const calibrated = !!ens?.ok;
  const spread = data.forecast.spreadC;
  const availableCount = data.forecast.models.filter((m) => m.available).length;
  const memberCount = ens?.selected?.length ?? 0;

  const isHko = data.station.icao === "HKO";
  // Today's METAR max (HKO: Observatory max) and when it was reached, station-local.
  const dayMax = day === "today" ? data.metar.runningMaxC : null;
  const latestMetar = data.metar.ok && !isHko ? data.metar.latest : undefined;
  const conditions = latestMetar?.raw
    ? describeMetar(latestMetar, { lat: data.station.lat, lon: data.station.lon, unit })
    : null;

  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {data.station.name}
            </h1>
            <span className="font-mono text-sm text-cyan">
              {data.station.icao}
            </span>
            <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-mute">
              {REGION_LABEL[data.station.region]}
            </span>
          </div>
          <p className="mt-1 break-words text-sm text-mute">
            {data.station.city} · {data.station.lat.toFixed(4)},{" "}
            {data.station.lon.toFixed(4)} · {isHko ? "observatory" : "airport"} ·{" "}
            <LocalClock timezone={data.station.timezone} compact />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {data.station.polymarketUrl && (
              <OutLink href={data.station.polymarketUrl}>Polymarket</OutLink>
            )}
            {isHko ? (
              <OutLink href="https://www.weather.gov.hk/en/cis/climat.htm">
                HKO Daily Extract
              </OutLink>
            ) : (
              <>
              {data.station.noaaUrl && (
                <OutLink href={data.station.noaaUrl}>NOAA resolution source</OutLink>
              )}
              {data.wu.forecastUrl && (
                <OutLink href={data.wu.forecastUrl}>
                  {`WU forecast ${formatTemp(data.wu.ok ? data.wu.dailyMaxC : null, unit, 1)}`}
                </OutLink>
              )}
              <OutLink href={data.husky.url ?? data.station.huskyUrl ?? `https://huskyweather.com/station/${data.station.icao}`}>
                {`Husky ${formatTemp(data.husky.ok ? data.husky.dailyMaxC : null, unit, 1)}`}
              </OutLink>
              </>
            )}
          </div>
        </div>
        <div className="flex w-full rounded-lg border border-line bg-surface-2 p-1 sm:w-auto">
          {(["today", "tomorrow"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDay(option)}
              className={`min-h-9 flex-1 rounded-md px-3 py-1.5 text-sm capitalize sm:flex-none ${
                day === option
                  ? "bg-cyan/15 text-cyan"
                  : "text-mute hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {(dayMax != null || conditions || data.trend) && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
          {dayMax != null && (
            <InfoCard label="Max today">
              <div className="font-mono text-2xl font-semibold tabular text-amber sm:text-3xl">
                {formatTemp(dayMax, unit, 1)}
              </div>
              <div className="mt-0.5 text-xs text-mute">
                {isHko ? "HKO" : "METAR"}
                {data.metar.runningMaxAt
                  ? ` · reached ${zonedHhMm(data.metar.runningMaxAt, data.station.timezone)} local`
                  : ""}
              </div>
            </InfoCard>
          )}
          {conditions && conditions.parts.length > 0 && latestMetar && (
            <InfoCard
              label={`METAR ${zonedHhMm(latestMetar.observedAt, data.station.timezone)} · now`}
              title={latestMetar.raw}
            >
              <div className="flex items-center gap-2">
                <WeatherIcon kind={conditions.icon} className="h-5 w-5 shrink-0 text-cyan" />
                <span className="font-mono text-lg font-semibold tabular text-ink">
                  {formatTemp(latestMetar.tempC, unit, 1)}
                </span>
                <span className="min-w-0 text-sm text-ink">{conditions.parts[0]}</span>
              </div>
              <DetailList items={conditions.parts.slice(1)} />
            </InfoCard>
          )}
          {data.trend && (
            <InfoCard
              label="Next 2 hours"
              title="Model hourly curves (one vote per family) re-anchored on the last METAR, the observed METAR slope, and instability signals (model split, showers/thunder, sudden jumps)."
              className="sm:col-span-2 lg:col-span-1"
            >
              <div className={`text-lg font-semibold ${TREND_LABEL[data.trend.state].tone}`}>
                {TREND_LABEL[data.trend.state].icon} {TREND_LABEL[data.trend.state].text}
              </div>
              <DetailList items={trendParts(data.trend, unit)} />
            </InfoCard>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div>
          {calibrated && ens ? (
            <>
              <div className="text-[11px] uppercase tracking-[0.16em] text-mute">
                Most likely METAR high · calibrated ensemble
              </div>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <div className="font-mono text-5xl leading-none tabular text-amber sm:text-6xl lg:text-7xl">
                  {unit === "C" ? `${ens.kTop}°C` : formatTemp(ens.kTop ?? null, unit, 0)}
                </div>
                <div className="pb-1 font-mono text-xl tabular text-ink">
                  {ens.pTop != null ? `${Math.round(ens.pTop * 100)}%` : ""}
                </div>
              </div>
              <div className="mt-2 text-sm break-words text-mute">
                Blend {formatTemp(ens.blendC ?? null, unit, 1)} corrected ({memberCount} models) · raw{" "}
                {formatTemp(ens.blendRawC ?? null, unit, 1)}
                {ens.range80 ? ` · 80% range ${ens.range80.lo}–${ens.range80.hi}°C` : ""}
                {ens.truncatedAt != null ? ` · below ${ens.truncatedAt}°C excluded (METAR high)` : ""}
              </div>
              <div className="mt-2 text-[11px] break-words text-mute">
                {LEAD_LABEL[ens.lead]} · {ens.correctionMethod} bias · {ens.blendMethod}
                {ens.recipeDate && ens.recipeDate !== data.marketDate ? ` · recipe of ${ens.recipeDate}` : ""}
                {ens.fittedThrough ? ` · fitted through ${ens.fittedThrough}` : ""}
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-[0.16em] text-mute">
                Raw model median · no calibrated correction
              </div>
              <div className="mt-1 font-mono text-5xl leading-none tabular text-ink sm:text-6xl lg:text-7xl">
                {formatTemp(data.forecast.headlineC, unit, 1)}
              </div>
              <div className="mt-2 text-sm break-words text-mute">
                {data.station.ensemble
                  ? (ens?.error ?? "Calibrated ensemble unavailable")
                  : "One vote per model family. This station has no calibrated ensemble: raw forecasts, uncorrected."}
              </div>
              {data.forecast.consensusModelIds.length > 0 && (
                <div className="mt-1 break-words font-mono text-[11px] text-mute">
                  {data.forecast.consensusModelIds.join(" · ")}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm sm:gap-3">
          <Stat
            label="Model spread"
            value={
              spread
                ? `${formatTemp(spread.min, unit, 1)} – ${formatTemp(spread.max, unit, 1)}`
                : "—"
            }
            hint={
              calibrated
                ? `corrected, ${data.forecast.models.filter((m) => m.status === "selected" || m.status === "eligible").length} models${ens?.spreadC != null ? ` · σ ${ens.spreadC.toFixed(2)}°C` : ""}`
                : `raw, ${availableCount} models`
            }
          />
          <Stat
            label="Peak window"
            value={formatPeak(data.forecast.peak?.time)}
            hint={
              data.forecast.peak
                ? `${formatTemp(data.forecast.peak.tempC, unit, 1)} on ${data.forecast.peak.modelId} hourly`
                : "no hourly max"
            }
          />
        </div>
      </div>
    </section>
  );
}

function InfoCard({
  label,
  title,
  className = "",
  children,
}: {
  label: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-line bg-surface-2 px-3 py-2.5 ${className}`}
      title={title}
    >
      <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-mute">{label}</div>
      {children}
    </div>
  );
}

function DetailList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[13px] leading-snug text-mute">
      {items.map((item) => (
        <li key={item} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-2.5 py-2 sm:px-3 sm:py-2.5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-sm tabular sm:text-base ${warn ? "text-warn" : "text-ink"}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-mute">{hint}</div>}
    </div>
  );
}
