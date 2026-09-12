import type { WeatherIconKind } from "@/lib/weatherIcon";
import type { TempUnit } from "@/lib/types";
import { formatTemp } from "@/lib/units";
import { WeatherIcon } from "./WeatherIcon";

export interface HourlyStripItem {
  key: string;
  hour: string;
  tempC: number | null;
  precipProb?: number | null;
  icon: WeatherIconKind;
  label?: string;
}

export function HourlyIconStrip({
  items,
  unit,
  empty,
  showPrecip = false,
}: {
  items: HourlyStripItem[];
  unit: TempUnit;
  empty?: string;
  showPrecip?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-bg px-3 py-4 text-xs text-mute">
        {empty ?? "No hourly data"}
      </div>
    );
  }

  return (
    <div className="scroll-pad mt-3 max-w-full overflow-x-auto overscroll-x-contain">
      <div className="flex w-max gap-0.5 sm:gap-1">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex w-10 shrink-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 text-center sm:w-[52px]"
            title={item.label}
          >
            <div className="font-mono text-[10px] tabular text-mute">
              {item.hour}
            </div>
            <WeatherIcon
              kind={item.icon}
              className="h-5 w-5 text-ink/85"
              title={item.label}
            />
            <div className="font-mono text-[11px] tabular text-ink">
              {formatTemp(item.tempC, unit, 0).replace("°C", "°").replace("°F", "°")}
            </div>
            {showPrecip && (
              <div className="font-mono text-[10px] tabular text-cyan/80">
                {item.precipProb == null ? "—" : `${Math.round(item.precipProb)}%`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
