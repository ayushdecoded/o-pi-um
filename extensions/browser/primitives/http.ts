import type { ChromeTab } from "../types.ts";

// Tiny fetch helper that turns HTTP failures into actionable tool errors.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok)
    throw new Error(`${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`.trim());
  return (await res.json()) as T;
}
