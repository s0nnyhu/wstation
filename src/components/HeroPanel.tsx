"use client";

import { REGION_LABEL } from "@/config/stations";
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
  applyCorrection,
  day,
  onDay,
}: {
  data: StationPayload;
  unit: TempUnit;
  applyCorrection: boolean;
  day: MarketDay;
  onDay: (day: MarketDay) => void;
}) {
  const primary = data.forecast.models.find(
    (m) => m.id === data.forecast.primaryId,
  );
  const heroC = applyCorrection
    ? (primary?.correctedMaxC ?? primary?.rawMaxC ?? null)
    : (primary?.rawMaxC ?? null);
  const otherC = applyCorrection
    ? (primary?.rawMaxC ?? null)
    : (primary?.correctedMaxC ?? null);
  const spread = applyCorrection
    ? data.forecast.spreadCorrectedC
    : data.forecast.spreadRawC;
  const consensusC = applyCorrection
    ? data.forecast.consensusCorrectedC
    : data.forecast.consensusRawC;
  const availableCount = data.forecast.models.filter((m) => m.available).length;

  // Resolution-style running high in the market unit (NOAA rounds integers).
  const marketUnit: TempUnit = data.polymarket.unit ?? data.station.defaultUnit;
  const synopticMax = data.synoptic.ok ? data.synoptic.resolutionMax : null;
  const metarResolutionMax =
    data.metar.resolutionMaxC != null
      ? Math.round(convertTemp(data.metar.resolutionMaxC, marketUnit))
      : null;
  const resolutionMax = synopticMax ?? metarResolutionMax;
  const resolutionSource = synopticMax != null ? "Synoptic (NOAA feed)" : "METAR body";

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
            {data.station.lon.toFixed(4)} · airport ·{" "}
            <LocalClock timezone={data.station.timezone} compact />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopySnapshotButton data={data} unit={unit} />
            {data.station.polymarketUrl && (
              <OutLink href={data.station.polymarketUrl}>Polymarket</OutLink>
            )}
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
          <div className="text-[11px] uppercase tracking-[0.16em] text-mute">
            {applyCorrection
              ? "Bias-corrected primary high"
              : "Raw primary high"}
          </div>
          <div className="mt-1 flex items-end gap-3">
            <div className="font-mono text-5xl leading-none tabular text-amber sm:text-6xl lg:text-7xl">
              {formatTemp(heroC, unit, 1)}
            </div>
          </div>
          <div className="mt-2 text-sm break-words text-mute">
            {applyCorrection ? "Raw" : "Corrected"}{" "}
            {formatTemp(otherC, unit, 1)} ·{" "}
            {primary?.label ?? data.forecast.primaryId}
            {primary?.bias && (
              <span>
                {" "}
                · {primary.bias.season}
                {primary.bias.source === "none"
                  ? " · no bias sample"
                  : ` · ${primary.bias.biasNative! > 0 ? "+" : ""}${primary.bias.biasNative!.toFixed(2)}°${primary.bias.unit} (${primary.bias.source}, n=${primary.bias.n})`}
              </span>
            )}
          </div>
          <div className="mt-3 text-sm">
            Consensus (median, one vote per model family){" "}
            <span className="font-mono tabular text-ink">
              {formatTemp(consensusC, unit, 1)}
            </span>
            <span className="text-mute">{applyCorrection ? " corrected" : " raw"}</span>
            {data.forecast.consensusModelIds.length > 0 && (
              <div className="mt-0.5 break-words font-mono text-[11px] text-mute">
                {data.forecast.consensusModelIds.join(" · ")}
              </div>
            )}
          </div>
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
              applyCorrection
                ? `${data.forecast.spreadCorrectedCount >= 2 ? data.forecast.spreadCorrectedCount : availableCount} of ${availableCount} models bias-corrected`
                : `${availableCount} models`
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
