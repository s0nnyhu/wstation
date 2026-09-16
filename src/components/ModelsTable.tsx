"use client";

import type { ModelRow, StationPayload, TempUnit } from "@/lib/types";
import { zonedHhMm } from "@/lib/time";
import { agreementBand, convertDelta, formatTemp } from "@/lib/units";

const ROLE_LABEL: Record<string, string> = {
  primary: "PRIMARY",
  "short-range": "SHORT",
  backup: "BACKUP",
  extra: "EXTRA",
  compare: "COMPARE",
};

function bandClass(band: ReturnType<typeof agreementBand>): string {
  if (band === "tight") return "text-good";
  if (band === "close") return "text-amber";
  if (band === "diverge") return "text-bad";
  return "text-mute";
}

function rowBg(row: ModelRow): string {
  if (row.role === "primary") return "bg-cyan/8";
  return "";
}

export function ModelsTable({
  data,
  unit,
  applyCorrection,
}: {
  data: StationPayload;
  unit: TempUnit;
  applyCorrection: boolean;
}) {
  const unitDelta = unit === "F" ? "°F" : "°C";

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">
            Models
          </h2>
          <p className="mt-1 text-xs text-mute">
            {data.biasMeta.source} · {data.biasMeta.sample} · as of {data.biasMeta.asOf}.{" "}
            {data.biasMeta.definition} Active season {data.forecast.season}
            {data.seasonMode !== "auto" ? ` (forced ${data.seasonMode})` : " (auto from market day)"}.
            MAE is the mean absolute error of the <em>raw</em> forecast over the same sample — an upper bound on the corrected error.
            Run is the last Open-Meteo initialisation (UTC) for the nest at this lat/lon.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Legend swatch="bg-good" label="≤0.5°C vs primary" />
          <Legend swatch="bg-amber" label="≤1.0°C" />
          <Legend swatch="bg-bad" label="diverge" />
        </div>
      </div>

      <div className="scroll-pad mt-3 flex gap-2 overflow-x-auto px-4 pb-2 sm:px-5">
        {data.forecast.models.map((row) => (
          <div
            key={row.id}
            className={`chip min-w-[5.5rem] rounded-lg px-2.5 py-2 ${
              row.role === "primary" ? "border-cyan/40" : ""
            }`}
          >
            <div className="font-mono text-[10px] text-mute">{row.id}</div>
            <div className="font-mono text-sm tabular text-ink">
              {formatTemp(
                applyCorrection ? row.correctedMaxC : row.rawMaxC,
                unit,
                1,
              )}
            </div>
            {row.run && (
              <div className="font-mono text-[10px] text-cyan">{row.run.initZ}</div>
            )}
          </div>
        ))}
      </div>

      <p className="px-4 text-[11px] text-mute sm:hidden">Swipe the table sideways.</p>
      <div className="scroll-pad overflow-x-auto">
        <table className="min-w-[920px] w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-mute">
            <tr className="border-y border-line">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium sm:px-5">
                Model
              </th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Raw max</th>
              <th className="px-3 py-2 font-medium">Season</th>
              <th className="px-3 py-2 font-medium">Bias applied</th>
              <th className="px-3 py-2 font-medium">MAE</th>
              <th className="px-3 py-2 font-medium">Corrected</th>
              <th className="px-3 py-2 font-medium">Δ vs primary</th>
              <th className="px-5 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.forecast.models.map((row) => {
              const delta = row.deltaVsPrimaryC;
              const band = agreementBand(delta);
              return (
                <tr
                  key={row.id}
                  className={`border-b border-line/70 ${rowBg(row)}`}
                >
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 sm:px-5">
                    <div className="font-medium">{row.label}</div>
                    <div className="font-mono text-[11px] text-mute">{row.id}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        row.role === "primary"
                          ? "bg-cyan/15 text-cyan"
                          : "bg-surface-2 text-mute"
                      }`}
                    >
                      {ROLE_LABEL[row.role]}
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
                    {row.hourlyDerived && (
                      <span className="ml-1 text-[10px] text-mute">hrly</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-cyan">
                      {row.bias.month ?? row.bias.season}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular text-mute">
                    <div>
                      {row.bias.source === "none" || row.bias.biasNative == null
                        ? "—"
                        : `${row.bias.biasNative > 0 ? "+" : ""}${row.bias.biasNative.toFixed(2)}°${row.bias.unit}`}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] uppercase ${
                          row.bias.source === "none"
                            ? "bg-warn/15 text-warn"
                            : "bg-surface-2 text-mute"
                        }`}
                      >
                        {row.bias.source}
                      </span>
                      {row.bias.source !== "none" && (
                        <span className="text-[10px] text-mute">n={row.bias.n}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular text-mute">
                    {row.bias.mae != null && row.bias.source !== "none"
                      ? `±${row.bias.mae.toFixed(2)}°${row.bias.unit}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular text-amber">
                    {formatTemp(row.correctedMaxC, unit, 1)}
                  </td>
                  <td className={`px-3 py-2.5 font-mono tabular ${bandClass(band)}`}>
                    {delta == null
                      ? "—"
                      : `${delta > 0 ? "+" : ""}${convertDelta(delta, unit).toFixed(1)}${unitDelta}`}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-mute">
                    {!row.available && "n/a at this location "}
                    {row.bias.source === "none" && (
                      <span className="text-warn">no bias sample </span>
                    )}
                    {row.note && <span>{row.note}</span>}
                    {data.backtest
                      .filter((b) => b.model === row.id && b.hitRate != null)
                      .map((b) => (
                        <span key={b.model}>
                          {" "}
                          hit-rate {(b.hitRate! * 100).toFixed(0)}% (n={b.n ?? "?"})
                        </span>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
