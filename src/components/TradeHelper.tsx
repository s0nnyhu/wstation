"use client";

import type { ReactNode } from "react";
import type { StationPayload, TempUnit } from "@/lib/types";
import type { Lead } from "@/lib/ensemble";
import { suggestBuckets, targetC } from "@/lib/buckets";
import { hoursUntilPeak, localNowHour } from "@/lib/time";
import { fallbackBucketStep, formatTemp } from "@/lib/units";

function horizon(hoursToPeak: number | null, day: "today" | "tomorrow"): "h18" | "h6" | "intraday" {
  if (day === "tomorrow") return "h18";
  if (hoursToPeak == null) return "h6";
  if (hoursToPeak > 12) return "h18";
  if (hoursToPeak > 3) return "h6";
  return "intraday";
}

/** What each consultation lead adds, for the calibrated-ensemble stations. */
const LEAD_CARDS: Array<{ lead: Lead; title: string; text: string }> = [
  {
    lead: "J1",
    title: "J1 · day before",
    text: "Latest runs for tomorrow, 30-day rolling bias per model, mean of the 5 best-ranked corrected models.",
  },
  {
    lead: "J0_08h",
    title: "J0 · 08:00",
    text: "Runs available at 08:00 (00Z for the fast models, 12Z of the day before for the slow ones), cumulative bias.",
  },
  {
    lead: "J0_10h30",
    title: "J0 · 10:30",
    text: "06Z runs in; outcomes below the METAR resolution high are excluded.",
  },
  {
    lead: "J0_13h30",
    title: "J0 · 13:30",
    text: "Last update: newest runs and the METAR high so far; the peak is usually 1–3 h away.",
  },
];

export function TradeHelper({ data, unit }: { data: StationPayload; unit: TempUnit }) {
  const ens = data.forecast.ensemble;
  const target = targetC(data);
  const buckets = suggestBuckets(data, target);
  const running = data.metar.runningMaxC;
  const localHour = localNowHour(data.localNow);
  const afterMidAfternoon = localHour != null && localHour >= 15;
  const locked =
    data.day === "today" &&
    running != null &&
    target != null &&
    running >= target - 0.3 &&
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
  const hoursToPeak =
    data.day === "today"
      ? hoursUntilPeak(data.forecast.peak?.time, data.localNow)
      : 24 + (hoursUntilPeak(data.forecast.peak?.time, data.localNow) ?? 15);

  const bucketChips = (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {buckets.items.length ? (
        buckets.items.map((b) => (
          <span
            key={b.label}
            className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
              b.target ? "border-amber/50 bg-amber/10 text-amber" : "border-line bg-surface text-mute"
            }`}
          >
            {b.label}
            {b.yesPrice != null && (
              <span className="ml-1 text-[10px] opacity-80">{Math.round(b.yesPrice * 100)}¢</span>
            )}
          </span>
        ))
      ) : (
        <span className="font-mono text-amber">—</span>
      )}
    </div>
  );

  const lockNote = locked ? (
    <div className="mt-2 text-good">
      High may be locked — running METAR high is near the forecast, temperature is declining, and it is after
      local mid-afternoon.
    </div>
  ) : null;

  return (
    <section className="panel p-4 sm:p-5">
      <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">Intraday / trade helper</h2>
      <p className="mt-1 text-xs leading-relaxed text-mute">
        Guidance only — not a recommendation. Buckets are{" "}
        {buckets.live
          ? `the live Polymarket ranges (°${buckets.marketUnit})`
          : `${fallbackBucketStep(data.station.region, buckets.marketUnit)}°${buckets.marketUnit} ranges (regional convention — live event unavailable)`}{" "}
        around the {ens?.ok ? "calibrated blend" : "raw model median"} rounded to an integer.
      </p>

      {ens ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEAD_CARDS.map((c) => {
            const active = c.lead === ens.lead;
            return (
              <HorizonCard
                key={c.lead}
                title={c.title}
                active={active}
                body={
                  <>
                    <div className={active ? "" : "text-mute"}>{c.text}</div>
                    {active && ens.ok && (
                      <>
                        <div className="mt-2">
                          Most likely <span className="font-mono text-amber">{ens.kTop}°C</span>{" "}
                          {ens.pTop != null ? `(${Math.round(ens.pTop * 100)}%)` : ""}
                          {ens.range80 ? ` · 80% ${ens.range80.lo}–${ens.range80.hi}°C` : ""}
                        </div>
                        <div className="mt-1">Buckets around {formatTemp(target, unit, 1)}:</div>
                        {bucketChips}
                        {lockNote}
                      </>
                    )}
                    {active && !ens.ok && <div className="mt-2 text-warn">{ens.error}</div>}
                  </>
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HorizonCard
            title="H−18"
            active={horizon(hoursToPeak, data.day) === "h18"}
            body={
              <>
                <div>
                  Raw median {formatTemp(data.forecast.headlineC, unit, 1)} (
                  {data.forecast.consensusModelIds.join(" · ") || "—"})
                </div>
                <div className="mt-1">
                  Spread{" "}
                  {data.forecast.spreadC
                    ? `${formatTemp(data.forecast.spreadC.min, unit, 1)}–${formatTemp(data.forecast.spreadC.max, unit, 1)}`
                    : "—"}
                </div>
                <div className="mt-1 text-mute">No calibrated correction for this station.</div>
              </>
            }
          />
          <HorizonCard
            title="H−6"
            active={horizon(hoursToPeak, data.day) === "h6"}
            body={
              <>
                <div>Refresh models + METAR before the peak window.</div>
                <div className="mt-1">
                  Bucket suggestion{buckets.resolvedInt != null ? ` (target ${buckets.resolvedInt}°${buckets.marketUnit})` : ""}:
                </div>
                {bucketChips}
                <div className="mt-1 text-mute">
                  Hours to peak: {hoursToPeak == null ? "—" : hoursToPeak.toFixed(1)}
                </div>
              </>
            }
          />
          <HorizonCard
            title="Intraday"
            active={horizon(hoursToPeak, data.day) === "intraday"}
            body={
              <>
                {seaSplit && (
                  <div className="mb-2 text-warn">GEM vs GFS disagree by ≥1°F — ASOS leans GEM, WU leans GFS.</div>
                )}
                {lockNote ?? (
                  <div>
                    Watch running high vs forecast max. Flag triggers after local 15:00 if METAR high is within
                    0.3°C of the forecast and the day is cooling.
                  </div>
                )}
              </>
            }
          />
        </div>
      )}
    </section>
  );
}

function HorizonCard({ title, active, body }: { title: string; active: boolean; body: ReactNode }) {
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
