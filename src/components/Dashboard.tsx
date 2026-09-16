"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStation } from "@/config/stations";
import { parseBiasGrain, parseSeasonMode } from "@/lib/bias";
import type {
  BiasGrain,
  MarketDay,
  RegionFilter,
  SeasonMode,
  StationPayload,
  TempUnit,
} from "@/lib/types";
import { Disclaimer } from "./Disclaimer";
import { DriversPanel } from "./DriversPanel";
import { HeroPanel } from "./HeroPanel";
import { HourlyChart } from "./HourlyChart";
import { LocalClock } from "./LocalClock";
import { ObservationTwin } from "./ObservationTwin";
import { ModelsTable } from "./ModelsTable";
import { PolymarketPanel } from "./PolymarketPanel";
import { StationSwitcher } from "./StationSwitcher";
import { TradeHelper } from "./TradeHelper";

export function Dashboard({
  data,
  initialRegionFilter = "all",
}: {
  data: StationPayload;
  initialRegionFilter?: RegionFilter;
}) {
  const stationKey = `${data.station.icao}:${data.day}:${data.compareAll ? "1" : "0"}:${data.seasonMode}:${data.biasGrain}`;
  const [scope, setScope] = useState(stationKey);
  const [live, setLive] = useState<StationPayload | null>(null);
  const [unit, setUnit] = useState<TempUnit>(data.station.defaultUnit);
  const [applyCorrection, setApplyCorrection] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<RegionFilter>(initialRegionFilter);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const inFlight = useRef(false);

  if (scope !== stationKey) {
    setScope(stationKey);
    setLive(null);
    setUnit(data.station.defaultUnit);
    setApplyCorrection(true);
    setError(null);
    setLastRefresh(null);
  }

  const view = live ?? data;
  const viewRef = useRef(view);
  viewRef.current = view;

  const loadStation = useCallback(
    async (opts: {
      icao: string;
      day: MarketDay;
      compareAll: boolean;
      seasonMode: SeasonMode;
      biasGrain: BiasGrain;
      fresh?: boolean;
      silent?: boolean;
      resetUnit?: boolean;
    }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!opts.silent) setRefreshing(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          day: opts.day,
          compareAll: opts.compareAll ? "1" : "0",
          season: opts.seasonMode,
          grain: opts.biasGrain,
        });
        if (opts.fresh) qs.set("fresh", "1");
        const res = await fetch(`/api/station/${opts.icao}?${qs}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const payload = json as StationPayload;
        if (opts.resetUnit) {
          setUnit(payload.station.defaultUnit);
          setApplyCorrection(true);
        }
        setLive(payload);
        setLastRefresh(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refresh failed");
      } finally {
        inFlight.current = false;
        setRefreshing(false);
      }
    },
    [],
  );

  function hrefFor(opts: {
    icao: string;
    day: MarketDay;
    compareAll: boolean;
    seasonMode: SeasonMode;
    biasGrain: BiasGrain;
  }): string {
    const params = new URLSearchParams({ s: opts.icao, d: opts.day });
    if (opts.compareAll) params.set("all", "1");
    if (opts.seasonMode !== "auto") params.set("season", opts.seasonMode);
    if (opts.biasGrain === "month") params.set("grain", "month");
    return `/?${params.toString()}`;
  }

  function go(next: {
    icao?: string;
    day?: MarketDay;
    compareAll?: boolean;
    seasonMode?: SeasonMode;
    biasGrain?: BiasGrain;
  }) {
    const icao = next.icao ?? view.station.icao;
    const day = next.day ?? view.day;
    const compareAll = next.compareAll ?? view.compareAll;
    const seasonMode = next.seasonMode ?? view.seasonMode;
    const biasGrain = next.biasGrain ?? view.biasGrain;
    const resetUnit = next.icao != null && next.icao !== view.station.icao;
    window.history.pushState(null, "", hrefFor({ icao, day, compareAll, seasonMode, biasGrain }));
    void loadStation({
      icao,
      day,
      compareAll,
      seasonMode,
      biasGrain,
      resetUnit,
    });
  }

  const refresh = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const current = viewRef.current;
      await loadStation({
        icao: current.station.icao,
        day: current.day,
        compareAll: current.compareAll,
        seasonMode: current.seasonMode,
        biasGrain: current.biasGrain,
        fresh: true,
        silent: opts.silent,
      });
    },
    [loadStation],
  );

  // Auto-refresh every 60 s while the tab is visible (METAR TTL is 2 min,
  // Polymarket 1 min — polling faster only hits the server cache).
  useEffect(() => {
    if (!autoRefresh) return;
    const AUTO_MS = 60_000;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh({ silent: true });
    };
    const id = window.setInterval(tick, AUTO_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [autoRefresh, refresh]);

  useEffect(() => {
    function onPopState() {
      const sp = new URLSearchParams(window.location.search);
      const current = viewRef.current;
      const icao = getStation(sp.get("s") ?? "")?.icao ?? current.station.icao;
      const day: MarketDay = sp.get("d") === "tomorrow" ? "tomorrow" : "today";
      const compareAll = sp.get("all") === "1" || sp.get("all") === "true";
      const seasonMode = parseSeasonMode(sp.get("season"));
      const biasGrain = parseBiasGrain(sp.get("grain"));
      void loadStation({
        icao,
        day,
        compareAll,
        seasonMode,
        biasGrain,
        resetUnit: icao !== current.station.icao,
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadStation]);

  const noBiasModels = view.forecast.models
    .filter((m) => m.bias.source === "none" && (m.role === "primary" || m.role === "short-range" || m.role === "backup"))
    .map((m) => m.id);
  const warnings = [
    ...view.station.warnings,
    ...(view.forecast.stale && view.forecast.staleReason
      ? [view.forecast.staleReason]
      : []),
    ...(view.metar.stale && view.metar.error ? [view.metar.error] : []),
    ...(view.polymarket.stale && view.polymarket.error ? [view.polymarket.error] : []),
    ...(noBiasModels.length
      ? [`no bias sample: ${noBiasModels.join(", ")}`]
      : []),
  ];

  return (
    <div className="min-h-full max-w-full overflow-x-clip">
      <header className="border-b border-line px-3 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] text-cyan">
              WStation
            </div>
            <div className="text-base font-semibold sm:text-lg">
              Airport high terminal
            </div>
            <div className="text-xs text-mute">
              Polymarket daily max · Europe + Asia + America
            </div>
          </div>
          <LocalClock
            timezone={view.station.timezone}
            label={`${view.station.icao} local`}
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-5 lg:flex-row">
        <aside className="min-w-0 lg:w-52 lg:shrink-0">
          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-mute">
            Stations
          </div>
          <StationSwitcher
            selected={view.station.icao}
            regionFilter={regionFilter}
            onFilter={setRegionFilter}
            onSelect={(icao) => go({ icao })}
          />
        </aside>

        <main className="min-w-0 flex-1 space-y-4 sm:space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Toggle
                label={`Units °${unit}`}
                on={unit === "F"}
                onClick={() => setUnit((u) => (u === "C" ? "F" : "C"))}
              />
              <Toggle
                label={applyCorrection ? "Bias on" : "Bias off"}
                on={applyCorrection}
                onClick={() => setApplyCorrection((v) => !v)}
              />
              <Toggle
                label={view.compareAll ? "Compare all" : "Default models"}
                on={view.compareAll}
                onClick={() => go({ compareAll: !view.compareAll })}
              />
              <Toggle
                label={view.biasGrain === "month" ? "Monthly" : "Seasonal"}
                on={view.biasGrain === "month"}
                onClick={() =>
                  go({ biasGrain: view.biasGrain === "month" ? "season" : "month" })
                }
              />
              <button
                type="button"
                onClick={() => void refresh()}
                className="chip min-h-9 rounded-lg px-3 py-1.5 text-xs text-mute hover:text-ink"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <Toggle
                label={autoRefresh ? "Auto 60s" : "Auto off"}
                on={autoRefresh}
                onClick={() => setAutoRefresh((v) => !v)}
              />
              {lastRefresh && (
                <span className="text-[11px] text-mute">
                  updated{" "}
                  {lastRefresh.toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              )}
            </div>
            <div className="scroll-pad -mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {(["auto", "DJF", "MAM", "JJA", "SON"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => go({ seasonMode: mode })}
                  className={`min-h-9 shrink-0 rounded-lg border px-3 py-1.5 text-xs ${
                    view.seasonMode === mode
                      ? "border-cyan/40 bg-cyan/10 text-cyan"
                      : "border-line bg-surface-2 text-mute"
                  }`}
                >
                  {mode === "auto" ? `Auto (${view.forecast.season})` : mode}
                </button>
              ))}
            </div>
            {view.station.icao === "EGLC" && (
              <span className="block text-[11px] text-mute">
                EGLC defaults to °C — toggle if a market is in °F.
              </span>
            )}
          </div>

          {warnings.map((warning) => (
            <div
              key={warning}
              className="break-words rounded-xl border border-warn/40 bg-warn/10 px-3 py-3 text-sm text-warn sm:px-4"
            >
              {warning}
            </div>
          ))}

          {view.station.notes.map((note) => (
            <div
              key={note}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-mute"
            >
              {note}
            </div>
          ))}

          {error && (
            <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
              {error}
            </div>
          )}

          <HeroPanel
            data={view}
            unit={unit}
            applyCorrection={applyCorrection}
            day={view.day}
            onDay={(day) => go({ day })}
          />
          <ObservationTwin data={view} unit={unit} />
          <DriversPanel data={view} />
          <ModelsTable
            data={view}
            unit={unit}
            applyCorrection={applyCorrection}
          />
          <HourlyChart
            key={`${view.station.icao}-${view.day}`}
            data={view}
            unit={unit}
          />
          <TradeHelper
            data={view}
            unit={unit}
            applyCorrection={applyCorrection}
          />
          <PolymarketPanel data={view} applyCorrection={applyCorrection} />
        </main>
      </div>
      <Disclaimer />
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs ${
        on
          ? "border-cyan/40 bg-cyan/10 text-cyan"
          : "border-line bg-surface-2 text-mute"
      }`}
    >
      {label}
    </button>
  );
}
