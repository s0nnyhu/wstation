"use client";

import { useEffect, useState } from "react";

export function LocalClock({
  timezone,
  label,
  compact = false,
}: {
  timezone: string;
  label?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const tick = () => {
      const options: Intl.DateTimeFormatOptions = compact
        ? {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          }
        : {
            timeZone: timezone,
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          };
      setNow(new Intl.DateTimeFormat("en-GB", options).format(new Date()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timezone, compact]);

  if (compact) {
    return <span className="font-mono tabular text-ink">{now || "—"}</span>;
  }

  return (
    <div className="shrink-0 text-right">
      <div className="font-mono text-[11px] tabular text-ink sm:text-sm">{now || "—"}</div>
      <div className="text-[10px] text-mute sm:text-[11px]">
        {label ?? timezone}
      </div>
    </div>
  );
}
