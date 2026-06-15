import { formatCompactNumber } from "../../shared/format.ts";

// Small shared formatting helpers. Keep dumb and dependency-free.
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${mm}m` : `${h}h`;
}

export const formatTokens = formatCompactNumber;

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
