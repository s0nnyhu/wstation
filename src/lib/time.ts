export function ageLabel(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function localHourLabel(isoLike: string): string {
  const stamp = isoLike.includes("T") ? isoLike.slice(11, 16) : isoLike;
  return stamp || "—";
}

/** Hours from station-local `localNow` (`YYYY-MM-DDTHH:MM:SS`) to a peak timestamp. */
export function hoursUntilPeak(
  peakTime: string | undefined,
  localNow: string,
): number | null {
  if (!peakTime) return null;
  const peakHour = Number(peakTime.slice(11, 13));
  const peakMinute = Number(peakTime.slice(14, 16) || "0");
  const nowHour = Number(localNow.slice(11, 13));
  const nowMinute = Number(localNow.slice(14, 16) || "0");
  if ([peakHour, peakMinute, nowHour, nowMinute].some((n) => Number.isNaN(n))) {
    return null;
  }
  return (peakHour * 60 + peakMinute - (nowHour * 60 + nowMinute)) / 60;
}

export function localNowHhMm(localNow: string): string | null {
  const hhmm = localNow.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

export function localNowHour(localNow: string): number | null {
  const hour = Number(localNow.slice(11, 13));
  return Number.isFinite(hour) ? hour : null;
}

export function fetchedAtMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Format a UTC instant as a model-run label, e.g. `09Z`. */
export function utcZLabel(iso: string | undefined | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;
}

/** Station-local `HH:MM` for an ISO timestamp. */
export function zonedHhMm(iso: string | undefined | null, timeZone: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}
