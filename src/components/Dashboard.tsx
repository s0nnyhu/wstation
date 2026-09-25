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

type NavTarget = {
  icao: string;
  day: MarketDay;
  compareAll: boolean;
  seasonMode: SeasonMode;
  biasGrain: BiasGrain;
};

type CacheEntry = { payload: StationPayload; at: number };

const CLIENT_FRESH_MS = 30_000;

function navKey(t: NavTarget): string {
  return `${t.icao}:${t.day}:${t.compareAll ? "1" : "0"}:${t.seasonMode}:${t.biasGrain}`;
}

function navFromPayload(data: StationPayload): NavTarget {
  return {
    icao: data.station.icao,
    day: data.day,
    compareAll: data.compareAll,
    seasonMode: data.seasonMode,
    biasGrain: data.biasGrain,
  };
}

export function Dashboard({
  data,
  initialRegionFilter = "all",
}: {
  data: StationPayload;
  initialRegionFilter?: RegionFilter;
}) {
  const stationKey = navKey(navFromPayload(data));
  const [scope, setScope] = useState(stationKey);
  const [live, setLive] = useState<StationPayload | null>(null);
  const [unit, setUnit] = useState<TempUnit>(data.station.defaultUnit);
  const [applyCorrection, setApplyCorrection] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<RegionFilter>(initialRegionFilter);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [pending, setPending] = useState<NavTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const cacheRef = useRef(new Map<string, CacheEntry>());
  const inflightRef = useRef(new Map<string, Promise<StationPayload | null>>());
  const desiredKeyRef = useRef(stationKey);

  if (!cacheRef.current.has(stationKey)) {
    cacheRef.current.set(stationKey, { payload: data, at: Date.now() });
  }

  if (scope !== stationKey) {
    setScope(stationKey);
    setLive(null);
    setUnit(data.station.defaultUnit);
    setApplyCorrection(true);
    setError(null);
    setLastRefresh(null);
    setPending(null);
    setBusy(false);
    desiredKeyRef.current = stationKey;
  }

  const view = live ?? data;
  const viewRef = useRef(view);
  viewRef.current = view;

  const nav = pending ?? navFromPayload(view);
  const navRef = useRef(nav);
  navRef.current = nav;
  desiredKeyRef.current = navKey(nav);

  const applyPayload = useCallback(
    (payload: StationPayload, resetUnit?: boolean) => {
      if (resetUnit) {
        setUnit(payload.station.defaultUnit);
        setApplyCorrection(true);
      }
      cacheRef.current.set(navKey(navFromPayload(payload)), {
        payload,
        at: Date.now(),
      });
      setLive(payload);
      setLastRefresh(new Date());
      setPending(null);
      setBusy(false);
      setError(null);
    },
    [],
  );

  const fetchStation = useCallback(
    (
      opts: NavTarget & {
        fresh?: boolean;
        silent?: boolean;
        resetUnit?: boolean;
      },
    ): Promise<StationPayload | null> => {
      const key = navKey(opts);
      const existing = inflightRef.current.get(key);
      if (existing) {
        return existing.then((payload) => {
          if (payload && desiredKeyRef.current === key) {
            applyPayload(payload, opts.resetUnit);
          }
          return payload;
        });
      }

      const request = (async () => {
        if (!opts.silent && desiredKeyRef.current === key) setRefreshing(true);
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
          cacheRef.current.set(key, { payload, at: Date.now() });
          if (desiredKeyRef.current === key) {
            applyPayload(payload, opts.resetUnit);
          }
          return payload;
        } catch (err) {
          if (desiredKeyRef.current === key) {
            setError(err instanceof Error ? err.message : "Refresh failed");
            setBusy(false);
          }
          return null;
        } finally {
          inflightRef.current.delete(key);
          if (desiredKeyRef.current === key) setRefreshing(false);
        }
      })();

      inflightRef.current.set(key, request);
      return request;
    },
    [applyPayload],
  );

  const showTarget = useCallback(
    (
      target: NavTarget & {
        fresh?: boolean;
        silent?: boolean;
        resetUnit?: boolean;
      },
    ) => {
      const key = navKey(target);
      desiredKeyRef.current = key;
      setError(null);

      if (target.resetUnit) {
        const station = getStation(target.icao);
        if (station) setUnit(station.defaultUnit);
        setApplyCorrection(true);
      }

      const hit = cacheRef.current.get(key);
      if (hit) {
        applyPayload(hit.payload, target.resetUnit);
        if (Date.now() - hit.at < CLIENT_FRESH_MS && !target.fresh) return;
        void fetchStation({ ...target, silent: true });
        return;
      }

      setPending(target);
      if (!target.silent) setBusy(true);
      void fetchStation(target);
    },
    [applyPayload, fetchStation],
  );

  function hrefFor(opts: NavTarget): string {
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
    const target: NavTarget = {
      icao: next.icao ?? nav.icao,
      day: next.day ?? nav.day,
      compareAll: next.compareAll ?? nav.compareAll,
      seasonMode: next.seasonMode ?? nav.seasonMode,
      biasGrain: next.biasGrain ?? nav.biasGrain,
    };
    const resetUnit = next.icao != null && next.icao !== view.station.icao;
    window.history.pushState(null, "", hrefFor(target));
    showTarget({ ...target, resetUnit });
  }

  const refresh = useCallback(
    async (opts: { silent?: boolean; fresh?: boolean } = {}) => {
      const current = navRef.current;
      await fetchStation({
        ...current,
        fresh: opts.fresh ?? true,
        silent: opts.silent,
      });
    },
    [fetchStation],
  );

  const prefetch = useCallback(
    (icao: string) => {
      const current = navRef.current;
      if (icao === current.icao) return;
      const target: NavTarget = { ...current, icao };
      const key = navKey(target);
      if (cacheRef.current.has(key) || inflightRef.current.has(key)) return;
      void fetchStation({ ...target, silent: true });
    },
    [fetchStation],
  );

  // METAR is fetched live on every request. The silent tick does not bust
  // forecast / WU / Polymarket caches; the Refresh button still does.
  useEffect(() => {
    if (!autoRefresh) return;
    const AUTO_MS = 15_000;
    const tick = () => {
      if (document.visibilityState === "visible") {
        void refresh({ silent: true, fresh: false });
      }
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
      const current = navRef.current;
      const target: NavTarget = {
        icao: getStation(sp.get("s") ?? "")?.icao ?? current.icao,
        day: sp.get("d") === "tomorrow" ? "tomorrow" : "today",
        compareAll: sp.get("all") === "1" || sp.get("all") === "true",
        seasonMode: parseSeasonMode(sp.get("season")),
        biasGrain: parseBiasGrain(sp.get("grain")),
      };
      showTarget({
        ...target,
        resetUnit: target.icao !== viewRef.current.station.icao,
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [showTarget]);

  const pendingStation = getStation(nav.icao);
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
            timezone={pendingStation?.timezone ?? view.station.timezone}
            label={`${nav.icao} local`}
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-5 lg:flex-row">
        <aside className="min-w-0 lg:w-52 lg:shrink-0">
          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-mute">
            Stations
          </div>
          <StationSwitcher
            selected={nav.icao}
            loading={busy}
            regionFilter={regionFilter}
            onFilter={setRegionFilter}
            onSelect={(icao) => go({ icao })}
            onPrefetch={prefetch}
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
                label={nav.compareAll ? "Compare all" : "Default models"}
                on={nav.compareAll}
                onClick={() => go({ compareAll: !nav.compareAll })}
              />
              <Toggle
                label={nav.biasGrain === "month" ? "Monthly" : "Seasonal"}
                on={nav.biasGrain === "month"}
                onClick={() =>
                  go({ biasGrain: nav.biasGrain === "month" ? "season" : "month" })
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
                label={autoRefresh ? "Auto 15s" : "Auto off"}
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
                    nav.seasonMode === mode
                      ? "border-cyan/40 bg-cyan/10 text-cyan"
                      : "border-line bg-surface-2 text-mute"
                  }`}
                >
                  {mode === "auto" ? `Auto (${view.forecast.season})` : mode}
                </button>
              ))}
            </div>
            {nav.icao === "EGLC" && (
              <span className="block text-[11px] text-mute">
                EGLC defaults to °C — toggle if a market is in °F.
              </span>
            )}
          </div>

          {busy && pendingStation && (
            <div className="rounded-xl border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
              {pending && pending.icao !== view.station.icao
                ? `Loading ${pendingStation.city} (${pendingStation.icao})…`
                : pending && pending.day !== view.day
                  ? `Loading ${pending.day}…`
                  : "Updating…"}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
              {error}
            </div>
          )}

          <div
            aria-busy={busy}
            className={`space-y-4 transition-opacity duration-150 sm:space-y-5 ${
              busy ? "pointer-events-none opacity-50" : "opacity-100"
            }`}
          >
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

            <HeroPanel
              data={view}
              unit={unit}
              applyCorrection={applyCorrection}
              day={nav.day}
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
          </div>
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
