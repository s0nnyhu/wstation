"use client";

import type { ModelRow, StationPayload, TempUnit } from "@/lib/types";
import type { MemberStatus } from "@/lib/ensemble";
import { zonedHhMm } from "@/lib/time";
import { agreementBand, convertDelta, formatTemp } from "@/lib/units";

const ROLE_LABEL: Record<string, string> = {
  primary: "PRIMARY",
  "short-range": "SHORT",
  backup: "BACKUP",
  extra: "EXTRA",
  compare: "COMPARE",
  blend: "BLEND",
  ensemble: "—",
};

const STATUS_LABEL: Record<MemberStatus, string> = {
  selected: "in blend",
  eligible: "not in top-k",
  redundant: "redundant with a same-family model",
  "no-skill-yet": "too little history to rank",
  "no-correction": "no correction published",
  missing: "no forecast for this day",
};

function bandClass(band: ReturnType<typeof agreementBand>): string {
  if (band === "tight") return "text-good";
  if (band === "close") return "text-amber";
  if (band === "diverge") return "text-bad";
  return "text-mute";
}

function signed(v: number, unit: TempUnit, digits = 2): string {
  const d = convertDelta(v, unit);
  return `${d > 0 ? "+" : ""}${d.toFixed(digits)}°${unit}`;
}

export function ModelsTable({ data, unit }: { data: StationPayload; unit: TempUnit }) {
  const ensemble = data.station.ensemble;
  const ens = data.forecast.ensemble;
  const headlineLabel = data.forecast.headlineKind === "blend" ? "blend" : "median";

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">Models</h2>
          {ensemble ? (
            <p className="mt-1 text-xs text-mute">
              Native models analysed by weather-analysis. Raw max = hourly max over the local day&apos;s hours at or
              after the run&apos;s initialisation (today: from the run available at the issue time, so a late run
              never hides the afternoon peak). Bias = walk-forward mean of past errors (forecast − METAR daily
              max) of the run available at this consultation time
              {ens?.correctionMethod ? ` (${ens.correctionMethod})` : ""}, refreshed daily; corrected = raw − bias.
              The blend ({ens?.blendMethod ?? "—"}) keeps one model per redundant family and ranks models by past
              error.
              {ens?.generatedUtc && ` Recipe generated ${ens.generatedUtc.replace("T", " ").slice(0, 16)} UTC.`}
            </p>
          ) : (
            <p className="mt-1 text-xs text-mute">
              Raw Open-Meteo forecasts. This station has no calibrated ensemble, so no bias correction is applied.
              Run is the last Open-Meteo initialisation (UTC) for the nest at this lat/lon.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Legend swatch="bg-good" label={`≤0.5°C vs ${headlineLabel}`} />
          <Legend swatch="bg-amber" label="≤1.0°C" />
          <Legend swatch="bg-bad" label="diverge" />
        </div>
      </div>

      <div className="scroll-pad mt-3 flex gap-2 overflow-x-auto px-4 pb-2 sm:px-5">
        {data.forecast.models.map((row) => (
          <div
            key={row.id}
            className={`chip min-w-[5.5rem] rounded-lg px-2.5 py-2 ${
              row.role === "blend" || row.role === "primary" ? "border-cyan/40" : ""
            }`}
          >
            <div className="font-mono text-[10px] text-mute">{row.id}</div>
            <div className="font-mono text-sm tabular text-ink">
              {formatTemp(row.correctedMaxC ?? row.rawMaxC, unit, 1)}
            </div>
            {row.run && <div className="font-mono text-[10px] text-cyan">{row.run.initZ}</div>}
          </div>
        ))}
      </div>

      <p className="px-4 text-[11px] text-mute sm:hidden">Swipe the table sideways.</p>
      <div className="scroll-pad overflow-x-auto">
        <table className={`${ensemble ? "min-w-[900px]" : "min-w-[680px]"} w-full text-left text-sm`}>
          <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
            <tr className="border-y border-line">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium sm:px-5">Model</th>
              <th className="px-3 py-2 font-medium">{ensemble ? "Blend" : "Role"}</th>
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Raw max</th>
              {ensemble && <th className="px-3 py-2 font-medium">Bias</th>}
              {ensemble && <th className="px-3 py-2 font-medium">Corrected</th>}
              {ensemble && <th className="px-3 py-2 font-medium">Weight</th>}
              <th className="px-3 py-2 font-medium">Δ vs {headlineLabel}</th>
              <th className="px-5 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.forecast.models.map((row) => (
              <Row key={row.id} row={row} data={data} unit={unit} ensemble={!!ensemble} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({
  row,
  data,
  unit,
  ensemble,
}: {
  row: ModelRow;
  data: StationPayload;
  unit: TempUnit;
  ensemble: boolean;
}) {
  const band = agreementBand(row.deltaC);
  const inBlend = row.role === "blend";
  return (
    <tr className={`border-b border-line/70 ${inBlend || row.role === "primary" ? "bg-cyan/8" : ""}`}>
      <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 sm:px-5">
        <div className="font-medium">{row.label}</div>
        <div className="font-mono text-[11px] text-mute">{row.id}</div>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
            inBlend || row.role === "primary" ? "bg-cyan/15 text-cyan" : "bg-surface-2 text-mute"
          }`}
        >
          {ensemble ? (inBlend ? "IN" : "OUT") : ROLE_LABEL[row.role]}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono tabular">
        {row.run ? (
          <div>
            <div className="text-ink">{row.run.initZ}</div>
            <div className="mt-0.5 text-[10px] text-mute">
              {row.run.nest ? `${row.run.nest} · ` : ""}
              {zonedHhMm(row.run.initAt, data.station.timezone)} loc
            </div>
          </div>
        ) : (
          <span className="text-mute">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 font-mono tabular">
        {formatTemp(row.rawMaxC, unit, 1)}
        {row.hourlyDerived && <span className="ml-1 text-[10px] text-mute">hrly</span>}
      </td>
      {ensemble && (
        <td className="px-3 py-2.5 font-mono tabular text-mute">
          {row.correctionC == null ? "—" : signed(row.correctionC, unit)}
          {row.correctionN != null && <div className="mt-0.5 text-[10px]">n={row.correctionN}</div>}
        </td>
      )}
      {ensemble && (
        <td className="px-3 py-2.5 font-mono tabular text-amber">{formatTemp(row.correctedMaxC, unit, 1)}</td>
      )}
      {ensemble && (
        <td className="px-3 py-2.5 font-mono tabular text-mute">
          {row.weight != null ? `${Math.round(row.weight * 100)}%` : "—"}
        </td>
      )}
      <td className={`px-3 py-2.5 font-mono tabular ${bandClass(band)}`}>
        {row.deltaC == null ? "—" : signed(row.deltaC, unit, 1)}
      </td>
      <td className="px-5 py-2.5 text-xs text-mute">
        {!row.available && !ensemble && "n/a at this location "}
        {ensemble && row.status && STATUS_LABEL[row.status]}
        {row.note && <span> {row.note}</span>}
      </td>
    </tr>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-mute">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </span>
  );
}
