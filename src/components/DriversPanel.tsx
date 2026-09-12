"use client";

import { weatherCodeHint } from "@/lib/drivers";
import type { StationPayload } from "@/lib/types";
import { formatMetarWind } from "@/lib/units";

function fmt(value: number | null | undefined, digits = 0, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function flagClass(flag: string): string {
  if (flag === "strong sun" || flag === "clearing") {
    return "border-amber/40 bg-amber/10 text-amber";
  }
  if (flag === "showers near peak" || flag === "thick cloud") {
    return "border-warn/40 bg-warn/10 text-warn";
  }
  if (flag === "wind cooling") {
    return "border-cyan/40 bg-cyan/10 text-cyan";
  }
  return "border-line bg-surface-2 text-mute";
}

export function DriversPanel({ data }: { data: StationPayload }) {
  const { drivers, forecast } = data;
  const peak = drivers.aroundPeak;
  const wx = weatherCodeHint(peak.dominantWeatherCode);

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">
              Drivers · peak window
            </h2>
            <span className="rounded-md border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan">
              Open-Meteo
            </span>
          </div>
          <p className="mt-1 text-xs text-mute">
            {drivers.windowLabel} · {drivers.modelId}
            {forecast.peak
              ? ` · peak ${forecast.peak.time.slice(11, 16)}`
              : ""}
            {wx ? ` · ${wx}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {drivers.flags.length ? (
            drivers.flags.map((flag) => (
              <span
                key={flag}
                className={`rounded-md border px-2 py-0.5 text-[11px] ${flagClass(flag)}`}
              >
                {flag}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-mute">no cooling / heating flag</span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Cloud" value={fmt(peak.avgCloudCover, 0, "%")} hint="mean cover" />
        <Stat
          label="Precip"
          value={`${fmt(peak.maxPrecipProb, 0, "%")} / ${fmt(peak.sumPrecipMm, 1, " mm")}`}
          hint="max prob / sum"
        />
        <Stat
          label="Wind"
          value={`${fmt(peak.avgWindSpeedMps, 1, " m/s")}`}
          hint={`gust ${fmt(peak.maxGustMps, 1, " m/s")}`}
        />
        <Stat
          label="Shortwave"
          value={fmt(peak.avgShortwaveWm2, 0, " W/m²")}
          hint="mean in window"
        />
      </div>

      <p className="mt-3 text-xs text-mute">
        METAR wind now{" "}
        <span className="font-mono text-ink">
          {formatMetarWind(
            drivers.now.metarWindDirDeg,
            drivers.now.metarWindKt,
            drivers.now.metarGustKt,
          )}
        </span>
        {drivers.now.cloudCover != null && (
          <>
            {" "}
            · hourly now cloud {fmt(drivers.now.cloudCover, 0, "%")}
            {drivers.now.precipProb != null
              ? ` · precip ${fmt(drivers.now.precipProb, 0, "%")}`
              : ""}
          </>
        )}
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-2.5 py-2 sm:px-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm tabular text-ink sm:text-base">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-mute">{hint}</div>}
    </div>
  );
}
