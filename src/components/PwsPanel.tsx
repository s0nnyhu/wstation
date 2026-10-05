"use client";

import { useEffect, useState } from "react";
import { ageLabel } from "@/lib/time";
import type { PwsReading, StationPayload, TempUnit } from "@/lib/types";
import { convertDelta, formatTemp } from "@/lib/units";

/** A PWS reading older than this no longer leads the METAR. */
const STALE_MIN = 30;

function obsClock(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function PwsCard({
  row,
  metarC,
  metarAt,
  unit,
  timeZone,
  now,
}: {
  row: PwsReading;
  metarC: number | null;
  metarAt: string | null;
  unit: TempUnit;
  timeZone: string;
  now: number;
}) {
  const ageMin = row.obsTimeIso
    ? Math.max(0, Math.round((now - Date.parse(row.obsTimeIso)) / 60_000))
    : null;
  const stale = ageMin == null || ageMin > STALE_MIN;
  const deltaC = row.ok && row.tempC != null && metarC != null ? row.tempC - metarC : null;
  // PWS observed after the METAR and differing by >= 0.5°C is the actual edge.
  const newerThanMetar =
    row.obsTimeIso != null && metarAt != null && Date.parse(row.obsTimeIso) > Date.parse(metarAt);
  const edge = deltaC != null && !stale && newerThanMetar && Math.abs(deltaC) >= 0.5;
  const deltaTone =
    deltaC == null || Math.abs(deltaC) < 0.05
      ? "text-mute"
      : deltaC > 0
        ? "text-hot"
        : "text-cyan";

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        edge
          ? (deltaC ?? 0) > 0
            ? "border-hot/60 bg-hot/10"
            : "border-cyan/60 bg-cyan/10"
          : "border-line bg-surface-2"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-[11px] uppercase tracking-[0.14em] text-mute">
          <a href={row.url} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
            {row.source} · {row.id}
          </a>
        </div>
        <div className={`shrink-0 text-[11px] ${stale ? "text-warn" : "text-good"}`}>
          {ageMin == null ? "no time" : ageLabel(row.obsTimeIso, now)}
        </div>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <div className="font-mono text-3xl font-semibold tabular sm:text-4xl">
          {row.ok ? formatTemp(row.tempC, unit, 1) : "—"}
        </div>
        {deltaC != null && (
          <div className={`font-mono text-sm tabular ${deltaTone}`} title="PWS minus latest METAR">
            {deltaC > 0 ? "+" : ""}
            {convertDelta(deltaC, unit).toFixed(1)}° vs METAR
          </div>
        )}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-mute">
        {row.ok
          ? `${row.name ? `${row.name} · ` : ""}obs ${obsClock(row.obsTimeIso, timeZone)} local${
              edge ? " · after last METAR" : ""
            }`
          : (row.error ?? "unavailable")}
      </div>
    </div>
  );
}

export function PwsPanel({ data, unit }: { data: StationPayload; unit: TempUnit }) {
  const { pws, metar, station } = data;
  const [now, setNow] = useState(() => Date.parse(pws.fetchedAt) || 0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  if (pws.stations.length === 0 && !pws.error) return null;

  const metarC = metar.ok ? (metar.latest?.tempC ?? null) : null;
  const metarAt = metar.ok ? (metar.latest?.observedAt ?? null) : null;

  return (
    <section className="panel p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-cyan">
          Personal weather stations · live
        </h2>
        <span className="text-[11px] text-mute">
          METAR {formatTemp(metarC, unit, 1)}
          {metarAt ? ` · ${ageLabel(metarAt, now)}` : ""}
          {pws.stale ? " · cached" : ""}
        </span>
      </div>
      {pws.stations.length === 0 ? (
        <div className="text-sm text-warn">{pws.error ?? "PWS unavailable"}</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {pws.stations.map((row) => (
            <PwsCard
              key={row.url}
              row={row}
              metarC={metarC}
              metarAt={metarAt}
              unit={unit}
              timeZone={station.timezone}
              now={now}
            />
          ))}
        </div>
      )}
    </section>
  );
}
