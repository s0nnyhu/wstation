"use client";

import { REGION_LABEL, STATIONS } from "@/config/stations";
import type { Region, RegionFilter } from "@/lib/types";

const FILTERS: { id: RegionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "europe", label: "Europe" },
  { id: "asia", label: "Asia" },
  { id: "america", label: "America" },
];

const REGION_ORDER: Region[] = ["europe", "asia", "america"];

export function StationSwitcher({
  selected,
  regionFilter,
  onFilter,
  onSelect,
}: {
  selected: string;
  regionFilter: RegionFilter;
  onFilter: (region: RegionFilter) => void;
  onSelect: (icao: string) => void;
}) {
  const visible = STATIONS.filter(
    (s) => regionFilter === "all" || s.region === regionFilter,
  );
  const groups = REGION_ORDER.map((region) => ({
    region,
    stations: visible.filter((s) => s.region === region),
  })).filter((g) => g.stations.length > 0);

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => onFilter(filter.id)}
            className={`min-h-9 flex-1 rounded-lg border px-2 py-1.5 text-[11px] lg:flex-none ${
              regionFilter === filter.id
                ? "border-cyan/40 bg-cyan/10 text-cyan"
                : "border-line bg-surface-2 text-mute"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <nav className="scroll-pad -mx-3 flex gap-2 overflow-x-auto px-3 pb-2 snap-x snap-mandatory lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0 lg:snap-none">
        {groups.map((group) => (
          <div
            key={group.region}
            className="flex shrink-0 gap-2 lg:flex-col lg:shrink"
          >
            <div className="flex min-w-[3.25rem] items-center px-1 text-[10px] uppercase tracking-[0.16em] text-mute lg:mt-2 lg:min-w-0 lg:items-end">
              {REGION_LABEL[group.region]}
            </div>
            {group.stations.map((station) => {
              const active = station.icao === selected;
              return (
                <button
                  key={station.icao}
                  type="button"
                  onClick={() => onSelect(station.icao)}
                  className={`flex min-h-14 min-w-[6.75rem] shrink-0 snap-start flex-col items-start rounded-xl px-3 py-2 text-left transition lg:min-h-0 lg:min-w-0 ${
                    active
                      ? "border-2 border-cyan bg-cyan/15 text-ink shadow-[0_0_16px_rgba(62,224,200,0.28)]"
                      : "chip text-mute hover:border-cyan/40 hover:text-ink"
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-mute">
                      {REGION_LABEL[station.region]}
                    </span>
                    {active && (
                      <span className="rounded bg-cyan px-1 py-px font-mono text-[9px] tracking-wide text-bg">
                        NOW
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-mono text-sm tracking-wide ${active ? "text-cyan" : "text-cyan/80"}`}
                  >
                    {station.icao}
                  </span>
                  <span className="text-xs">{station.city}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
