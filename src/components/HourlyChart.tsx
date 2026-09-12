"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StationPayload, TempUnit } from "@/lib/types";
import { convertTemp, formatTemp } from "@/lib/units";

const PALETTE = [
  "#3ee0c8",
  "#f0b429",
  "#7aa2ff",
  "#ff7ab6",
  "#9b8afb",
  "#4ade80",
  "#fb923c",
  "#94a3b8",
];

function hourLabel(time: string): string {
  return time.slice(11, 16);
}

function currentHourInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

export function HourlyChart({
  data,
  unit,
}: {
  data: StationPayload;
  unit: TempUnit;
}) {
  const models = data.forecast.models.filter((m) => m.available);
  const [overlays, setOverlays] = useState<string[]>([data.forecast.primaryId]);
  const [showDrivers, setShowDrivers] = useState(true);
  const visible = overlays.filter((id) => models.some((m) => m.id === id));

  const chartData = data.forecast.hourly.map((point) => {
    const row: Record<string, string | number | null> = {
      time: hourLabel(point.time),
      cloud: point.cloudCover,
      precipProb: point.precipProb,
    };
    for (const model of models) {
      const c = point.tempsC[model.id];
      row[model.id] = c == null ? null : Number(convertTemp(c, unit).toFixed(2));
    }
    return row;
  });

  // Peak marker computed on the primary's own hourly series so the dot always
  // sits on the line it is drawn over (forecast.peak may come from the
  // short-range model).
  const primaryPeak = data.forecast.hourly.reduce<{ time: string; tempC: number } | null>(
    (best, point) => {
      const c = point.tempsC[data.forecast.primaryId];
      if (c == null) return best;
      return !best || c > best.tempC ? { time: point.time, tempC: c } : best;
    },
    null,
  );
  const peakHour = primaryPeak ? hourLabel(primaryPeak.time) : null;
  const nowHour = data.day === "today" ? currentHourInZone(data.station.timezone) : null;
  const metarNow =
    data.metar.latest?.tempC != null
      ? convertTemp(data.metar.latest.tempC, unit)
      : null;
  const running =
    data.day === "today" && data.metar.runningMaxC != null
      ? convertTemp(data.metar.runningMaxC, unit)
      : null;

  function toggle(id: string) {
    setOverlays((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-mute">
          Hourly temperature
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setShowDrivers((v) => !v)}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              showDrivers
                ? "border-cyan/40 bg-cyan/10 text-cyan"
                : "border-line text-mute"
            }`}
          >
            Cloud / precip
          </button>
          {models.map((model, i) => {
            const on = visible.includes(model.id);
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => toggle(model.id)}
                className={`rounded-md border px-2 py-1 font-mono text-[11px] ${
                  on
                    ? "border-transparent text-bg"
                    : "border-line text-mute"
                }`}
                style={
                  on
                    ? { background: PALETTE[i % PALETTE.length] }
                    : undefined
                }
              >
                {model.id}
              </button>
            );
          })}
        </div>
      </div>

      <div className="-mx-1 mt-4 h-[220px] w-full sm:mx-0 sm:h-[280px] lg:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#253140" strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              stroke="#8b98a8"
              tick={{ fill: "#8b98a8", fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="temp"
              stroke="#8b98a8"
              tick={{ fill: "#8b98a8", fontSize: 11 }}
              unit={`°${unit}`}
              domain={["auto", "auto"]}
              width={44}
            />
            {showDrivers && (
              <YAxis
                yAxisId="pct"
                orientation="right"
                stroke="#7aa2ff"
                tick={{ fill: "#7aa2ff", fontSize: 10 }}
                domain={[0, 100]}
                width={32}
                unit="%"
              />
            )}
            <Tooltip
              contentStyle={{
                background: "#10161e",
                border: "1px solid #253140",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#8b98a8" }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#8b98a8" }} />
            {showDrivers && (
              <Area
                yAxisId="pct"
                type="monotone"
                dataKey="cloud"
                name="Cloud %"
                stroke="#7aa2ff"
                strokeOpacity={0.55}
                fill="#7aa2ff"
                fillOpacity={0.12}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {showDrivers && (
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="precipProb"
                name="Precip %"
                stroke="#9b8afb"
                strokeWidth={1.2}
                strokeDasharray="4 3"
                strokeOpacity={0.85}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {nowHour && (
              <ReferenceLine
                yAxisId="temp"
                x={nowHour.slice(0, 2) + ":00"}
                stroke="#8b98a8"
                strokeDasharray="4 4"
                label={{ value: "now", fill: "#8b98a8", fontSize: 10 }}
              />
            )}
            {metarNow != null && (
              <ReferenceLine
                yAxisId="temp"
                y={metarNow}
                stroke="#3ee0c8"
                strokeDasharray="3 3"
                label={{
                  value: `METAR ${formatTemp(data.metar.latest?.tempC, unit, 1)}`,
                  fill: "#3ee0c8",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
            {running != null && (
              <ReferenceLine
                yAxisId="temp"
                y={running}
                stroke="#f0b429"
                strokeDasharray="2 6"
                label={{
                  value: "run high",
                  fill: "#f0b429",
                  fontSize: 10,
                  position: "insideBottomRight",
                }}
              />
            )}
            {visible.map((id) => {
              const idx = models.findIndex((m) => m.id === id);
              return (
                <Line
                  key={id}
                  yAxisId="temp"
                  type="monotone"
                  dataKey={id}
                  name={id}
                  stroke={PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length]}
                  strokeWidth={id === data.forecast.primaryId ? 2.4 : 1.4}
                  dot={false}
                  connectNulls
                />
              );
            })}
            {primaryPeak && peakHour && visible.includes(data.forecast.primaryId) && (
              <ReferenceDot
                yAxisId="temp"
                x={peakHour}
                y={convertTemp(primaryPeak.tempC, unit)}
                r={5}
                fill="#f0b429"
                stroke="#080b10"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
