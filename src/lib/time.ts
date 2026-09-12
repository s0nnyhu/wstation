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
