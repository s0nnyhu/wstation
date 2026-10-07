"use client";

import { REGION_LABEL } from "@/config/stations";
import { LEAD_LABEL } from "@/lib/ensemble";
import type { MarketDay, StationPayload, TempUnit } from "@/lib/types";
import { convertTemp, formatTemp } from "@/lib/units";
import { CopySnapshotButton } from "./CopySnapshotButton";
import { LocalClock } from "./LocalClock";
import { OutLink } from "./OutLink";

function formatPeak(time: string | undefined): string {
  if (!time) return "—";
  return time.includes("T") ? time.slice(11, 16) : time;
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

  // Resolution-style running high in the market unit (NOAA rounds integers).
  const marketUnit: TempUnit = data.polymarket.unit ?? data.station.defaultUnit;
  const synopticMax = data.synoptic.ok ? data.synoptic.resolutionMax : null;
  const metarResolutionMax =
    data.metar.resolutionMaxC != null
      ? Math.round(convertTemp(data.metar.resolutionMaxC, marketUnit))
      : null;
  const resolutionMax = synopticMax ?? metarResolutionMax;
  const resolutionSource = synopticMax != null ? "Synoptic (NOAA feed)" : "METAR body";

  const isHko = data.station.icao === "HKO";

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
            <CopySnapshotButton data={data} unit={unit} />
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
              {data.station.wuHistoryUrl && (
                <OutLink href={data.station.wuHistoryUrl}>WU history</OutLink>
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
            label="Market day"
            value={data.marketDate}
            hint={data.station.timezone}
          />
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
            label="METAR now"
            value={formatTemp(data.metar.latest?.tempC, unit, 1)}
            hint={
              data.metar.ok
                ? "latest observation"
                : (data.metar.error ?? "unavailable")
            }
          />
          <Stat
            label="Running high"
            value={
              day === "today"
                ? formatTemp(data.metar.runningMaxC, unit, 1)
                : "—"
            }
            hint={
              day === "tomorrow"
                ? "tomorrow not started"
                : data.metar.runningMaxC == null
                  ? "no METAR yet today"
                  : "today’s METAR max (tenths)"
            }
          />
          <Stat
            label="Resolution high"
            value={
              day === "today" && resolutionMax != null
                ? `${resolutionMax}°${marketUnit}`
                : "—"
            }
            hint={
              day === "tomorrow"
                ? "tomorrow not started"
                : resolutionMax == null
                  ? "no observation yet"
                  : synopticMax != null
                    ? `${resolutionSource} · ${data.synoptic.observationCount} obs`
                    : `${resolutionSource} · lower bound, 5-min obs unseen`
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
