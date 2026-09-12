"use client";

import type { ReactNode } from "react";
import type { StationPayload, TempUnit } from "@/lib/types";
import {
  bucketIndexFor,
  convertTemp,
  fallbackBucketStep,
  fallbackBuckets,
  formatBucketRange,
  formatTemp,
} from "@/lib/units";

interface BucketSuggestion {
  label: string;
  target: boolean;
  yesPrice: number | null;
}

/**
 * Buckets around the resolved integer. Uses the live Polymarket event when
 * available, else the regional convention (US 2 °F even-aligned, EU 1 °C).
 */
function suggestBuckets(
  data: StationPayload,
  targetC: number | null,
): { marketUnit: TempUnit; resolvedInt: number | null; live: boolean; items: BucketSuggestion[] } {
  const pm = data.polymarket;
  const marketUnit: TempUnit = pm.unit ?? data.station.defaultUnit;
  if (targetC == null) return { marketUnit, resolvedInt: null, live: false, items: [] };
  const resolvedInt = Math.round(convertTemp(targetC, marketUnit));

  if (pm.ok && pm.buckets.length > 0) {
    const idx = bucketIndexFor(pm.buckets, resolvedInt);
    if (idx >= 0) {
      const items = pm.buckets
        .slice(Math.max(0, idx - 1), idx + 2)
        .map((b) => ({ label: b.label, target: b === pm.buckets[idx], yesPrice: b.yesPrice }));
      return { marketUnit, resolvedInt, live: true, items };
    }
  }

  const step = fallbackBucketStep(data.station.region, marketUnit);
  const ranges = fallbackBuckets(resolvedInt, step);
  return {
    marketUnit,
    resolvedInt,
    live: false,
    items: ranges.map((r, i) => ({
      label: formatBucketRange(r, marketUnit),
      target: i === 1,
      yesPrice: null,
    })),
  };
}

function hoursFromPeak(peakTime: string | undefined, timezone: string): number | null {
  if (!peakTime) return null;
  const hour = Number(peakTime.slice(11, 13));
  const minute = Number(peakTime.slice(14, 16) || "0");
  if (Number.isNaN(hour)) return null;
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const nowMin = Number(nowParts.hour) * 60 + Number(nowParts.minute);
  const peakMin = hour * 60 + minute;
  return (peakMin - nowMin) / 60;
}

function horizon(hoursToPeak: number | null, day: "today" | "tomorrow"): "h18" | "h6" | "intraday" {
  if (day === "tomorrow") return "h18";
  if (hoursToPeak == null) return "h6";
  if (hoursToPeak > 12) return "h18";
  if (hoursToPeak > 3) return "h6";
  return "intraday";
}

export function TradeHelper({
  data,
  unit,
  applyCorrection,
}: {
  data: StationPayload;
  unit: TempUnit;
  applyCorrection: boolean;
}) {
  const primary = data.forecast.models.find((m) => m.id === data.forecast.primaryId);
  const primaries = data.forecast.models.filter(
    (m) =>
      (m.role === "primary" || data.station.primaryModels.includes(m.id)) &&
      m.available,
  );
  const backups = data.forecast.models.filter((m) => m.role === "backup" && m.available);
  const h6Id =
    data.station.h6Model ?? data.station.shortRange ?? data.forecast.primaryId;
  const h6 = data.forecast.models.find((m) => m.id === h6Id);
  const targetC = applyCorrection
    ? (h6?.correctedMaxC ?? primary?.correctedMaxC ?? primary?.rawMaxC)
    : (h6?.rawMaxC ?? primary?.rawMaxC);
  const buckets = suggestBuckets(data, targetC ?? null);
  const hoursToPeak = data.day === "today"
    ? hoursFromPeak(data.forecast.peak?.time, data.station.timezone)
    : 24 + (hoursFromPeak(data.forecast.peak?.time, data.station.timezone) ?? 15);
  const active = horizon(hoursToPeak, data.day);

  const spread = applyCorrection
    ? data.forecast.spreadCorrectedC
    : data.forecast.spreadRawC;
  const running = data.metar.runningMaxC;
  const forecastMax = targetC;
  const localHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: data.station.timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const afterMidAfternoon = Number.isFinite(localHour) && localHour >= 15;
  const locked =
    data.day === "today" &&
    running != null &&
    forecastMax != null &&
    running >= forecastMax - 0.3 &&
    data.metar.declining &&
    afterMidAfternoon &&
    (data.metar.latest?.tempC ?? running) <= running - 0.4;

  const gem = data.forecast.models.find((m) => m.id === "gem_seamless");
  const gfs = data.forecast.models.find((m) => m.id === "gfs_seamless");
  const seaSplit =
    data.station.icao === "KSEA" &&
    gem?.rawMaxC != null &&
    gfs?.rawMaxC != null &&
    Math.abs(gem.rawMaxC - gfs.rawMaxC) >= 0.56;

  return (
    <section className="panel p-4 sm:p-5">
      <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">
        Intraday / trade helper
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-mute">
        Guidance only — not a recommendation. Buckets are{" "}
        {buckets.live
          ? `the live Polymarket ranges (°${buckets.marketUnit})`
          : `${fallbackBucketStep(data.station.region, buckets.marketUnit)}°${buckets.marketUnit} ranges (regional convention — live event unavailable)`}{" "}
        around the {applyCorrection ? "bias-corrected" : "raw"} target rounded to
        an integer.
        {primary?.bias && applyCorrection && (
          <>
            {" "}
            Applied {primary.bias.season} {primary.bias.source}
            {primary.bias.biasNative != null
              ? ` bias ${primary.bias.biasNative > 0 ? "+" : ""}${primary.bias.biasNative.toFixed(2)}°${primary.bias.unit}`
              : " (no bias sample)"}
            {h6 && h6.id !== primary.id && h6.bias
              ? ` · H−6 ${h6.id} ${h6.bias.season} ${h6.bias.source}`
              : ""}
            .
          </>
        )}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HorizonCard
          title="H−18"
          active={active === "h18"}
          body={
            <>
              <div>
                Primaries:{" "}
                {primaries.length
                  ? primaries
                      .map(
                        (p) =>
                          `${p.id} ${formatTemp(p.rawMaxC, unit, 1)} / ${formatTemp(p.correctedMaxC, unit, 1)} corr`,
                      )
                      .join(" · ")
                  : `${primary?.id ?? "—"} ${formatTemp(primary?.rawMaxC ?? null, unit, 1)}`}
              </div>
              <div className="mt-1">
                Backups:{" "}
                {backups.length
                  ? backups
                      .map((b) => `${b.id} ${formatTemp(b.correctedMaxC, unit, 1)}`)
                      .join(" · ")
                  : "—"}
              </div>
              <div className="mt-1">
                Spread{" "}
                {spread
                  ? `${formatTemp(spread.min, unit, 1)}–${formatTemp(spread.max, unit, 1)}`
                  : "—"}
              </div>
            </>
          }
        />
        <HorizonCard
          title="H−6"
          active={active === "h6"}
          body={
            <>
              <div>
                Prefer {h6?.label ?? h6Id}
                {h6?.available
                  ? ` ${formatTemp(applyCorrection ? h6.correctedMaxC : h6.rawMaxC, unit, 1)}`
                  : " (n/a — falling back to primary)"}
                {data.station.region === "america" &&
                  (h6Id === "gfs_hrrr"
                    ? " · CONUS short-range"
                    : h6Id === "gem_hrdps_continental"
                      ? " · KSEA HRDPS"
                      : "")}
              </div>
              <div className="mt-1">Refresh models + METAR before the peak window.</div>
              <div className="mt-1">
                Bucket suggestion
                {buckets.resolvedInt != null
                  ? ` (target ${buckets.resolvedInt}°${buckets.marketUnit})`
                  : ""}
                :
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {buckets.items.length ? (
                  buckets.items.map((b) => (
                    <span
                      key={b.label}
                      className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
                        b.target
                          ? "border-amber/50 bg-amber/10 text-amber"
                          : "border-line bg-surface text-mute"
                      }`}
                    >
                      {b.label}
                      {b.yesPrice != null && (
                        <span className="ml-1 text-[10px] opacity-80">
                          {Math.round(b.yesPrice * 100)}¢
                        </span>
                      )}
                    </span>
                  ))
                ) : (
                  <span className="font-mono text-amber">—</span>
                )}
              </div>
              <div className="mt-1 text-mute">
                Hours to primary peak:{" "}
                {hoursToPeak == null ? "—" : hoursToPeak.toFixed(1)}
              </div>
            </>
          }
        />
        <HorizonCard
          title="Intraday"
          active={active === "intraday"}
          body={
            <>
              {seaSplit && (
                <div className="mb-2 text-warn">
                  GEM vs GFS disagree by ≥1°F — ASOS leans GEM, WU leans GFS.
                </div>
              )}
              {locked ? (
                <div className="text-good">
                  High may be locked — running METAR high is near the forecast max,
                  temperature is declining, and it is after local mid-afternoon.
                </div>
              ) : (
                <div>
                  Watch running high vs forecast max. Flag triggers after local 15:00 if
                  METAR high is within 0.3°C of the forecast and the day is cooling.
                </div>
              )}
            </>
          }
        />
      </div>
    </section>
  );
}

function HorizonCard({
  title,
  active,
  body,
}: {
  title: string;
  active: boolean;
  body: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 text-sm ${
        active ? "border-cyan/50 bg-cyan/8" : "border-line bg-surface-2"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-xs tracking-wide text-cyan">{title}</div>
        {active && <span className="text-[10px] uppercase text-cyan">now</span>}
      </div>
      <div className="mt-2 break-words text-ink/90">{body}</div>
    </div>
  );
}
