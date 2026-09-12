"use client";

import type { StationPayload, TempUnit } from "@/lib/types";
import {
  bucketIndexFor,
  bucketProbabilities,
  convertDelta,
  convertTemp,
  sigmaFromMae,
} from "@/lib/units";
import { OutLink } from "./OutLink";

function cents(price: number | null): string {
  if (price == null) return "—";
  return `${Math.round(price * 100)}¢`;
}

function pct(p: number | undefined): string {
  if (p == null) return "";
  if (p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

export function PolymarketPanel({
  data,
  applyCorrection,
}: {
  data: StationPayload;
  applyCorrection: boolean;
}) {
  const pm = data.polymarket;
  const href = pm.url ?? data.station.polymarketUrl;
  const marketUnit: TempUnit = pm.unit ?? data.station.defaultUnit;

  const primary = data.forecast.models.find((m) => m.id === data.forecast.primaryId);
  const targetC = applyCorrection
    ? (primary?.correctedMaxC ?? primary?.rawMaxC ?? null)
    : (primary?.rawMaxC ?? null);
  const targetMarket = targetC == null ? null : convertTemp(targetC, marketUnit);
  const targetIdx =
    targetMarket == null ? -1 : bucketIndexFor(pm.buckets, Math.round(targetMarket));
  const consensusC = applyCorrection
    ? data.forecast.consensusCorrectedC
    : data.forecast.consensusRawC;
  const consensusIdx =
    consensusC == null
      ? -1
      : bucketIndexFor(pm.buckets, Math.round(convertTemp(consensusC, marketUnit)));

  // Resolution-style running high (integer in market unit), Synoptic first.
  const synopticMax = data.synoptic.ok ? data.synoptic.resolutionMax : null;
  const metarResolutionMax =
    data.metar.resolutionMaxC != null
      ? Math.round(convertTemp(data.metar.resolutionMaxC, marketUnit))
      : null;
  const resolutionMax = data.day === "today" ? (synopticMax ?? metarResolutionMax) : null;
  const runningIdx = resolutionMax == null ? -1 : bucketIndexFor(pm.buckets, resolutionMax);

  // Approximate bucket probabilities: Normal(target, σ) with σ = MAE·√(π/2).
  // MAE is the raw-forecast MAE in the bias file unit; convert to market unit.
  const mae = primary?.bias.mae;
  const maeMarket =
    mae == null || primary == null || primary.bias.source === "none"
      ? null
      : primary.bias.unit === marketUnit
        ? mae
        : primary.bias.unit === "C"
          ? convertDelta(mae, "F")
          : (mae * 5) / 9;
  const probs =
    targetMarket != null && maeMarket != null
      ? bucketProbabilities(pm.buckets, targetMarket, sigmaFromMae(maeMarket))
      : null;

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">
            Polymarket buckets
          </h2>
          <p className="mt-1 text-xs text-mute">
            {pm.ok
              ? `${pm.title ?? pm.slug} · ${pm.buckets.length} outcomes · ${pm.step ?? "?"}°${marketUnit} ranges`
              : (pm.error ?? "Event unavailable")}
            {pm.resolutionHint ? ` · resolves on ${pm.resolutionHint}` : ""}
            {pm.stale ? " · stale cache" : ""}
            {pm.closed ? " · CLOSED" : ""}
          </p>
        </div>
        {href && <OutLink href={href}>Open market</OutLink>}
      </div>

      {pm.ok && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {pm.buckets.map((b, i) => {
              const isTarget = i === targetIdx;
              const isRunning = i === runningIdx;
              const isConsensus = i === consensusIdx;
              const p = probs?.[i];
              const edge =
                p != null && b.yesPrice != null ? p - b.yesPrice : null;
              return (
                <div
                  key={b.label}
                  className={`rounded-lg border px-2 py-2 text-center ${
                    isTarget
                      ? "border-amber/60 bg-amber/10"
                      : isRunning
                        ? "border-cyan/50 bg-cyan/10"
                        : "border-line bg-surface-2"
                  }`}
                >
                  <div className="font-mono text-[11px] text-mute">{b.label}</div>
                  <div
                    className={`mt-1 font-mono text-sm tabular ${
                      isTarget ? "text-amber" : "text-ink"
                    }`}
                  >
                    {cents(b.yesPrice)}
                  </div>
                  {(b.bestBid != null || b.bestAsk != null) && (
                    <div className="mt-0.5 font-mono text-[10px] text-mute">
                      {cents(b.bestBid)} / {cents(b.bestAsk)}
                    </div>
                  )}
                  {p != null && (
                    <div
                      className={`mt-1 font-mono text-[11px] tabular ${
                        edge != null && edge >= 0.1
                          ? "text-good"
                          : edge != null && edge <= -0.1
                            ? "text-bad"
                            : "text-mute"
                      }`}
                      title="Approximate model probability (normal, σ from raw MAE)"
                    >
                      ≈{pct(p)}
                    </div>
                  )}
                  <div className="mt-1 flex justify-center gap-1 text-[9px] uppercase tracking-wide">
                    {isTarget && <span className="text-amber">target</span>}
                    {isConsensus && <span className="text-mute">cons.</span>}
                    {isRunning && <span className="text-cyan">res. high</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-mute">
            Yes price · bid / ask. Target = {applyCorrection ? "bias-corrected" : "raw"} primary
            rounded to the market integer; cons. = family consensus; res. high = today&apos;s
            resolution-style running high (
            {synopticMax != null ? "Synoptic feed" : "METAR body integers, lower bound"}).
            {probs
              ? ` ≈% is an approximate model probability: Normal(target, σ = 1.25 × raw MAE ${maeMarket?.toFixed(2)}°${marketUnit}) — not calibrated on Polymarket outcomes, and the raw MAE overstates the corrected error. Green / red when it differs from the price by ≥10 pts.`
              : " No MAE for the primary in this season — no model probability shown."}
          </p>
        </>
      )}
    </section>
  );
}
