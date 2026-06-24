import {
  DEFAULT_BROWSER_URL,
  DEFAULT_MAX_CHARS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ZEN_BROWSER_URL,
  HARD_MAX_CHARS,
} from "./constants.ts";

export function clampMaxChars(value: unknown): number {
  // Bound tool output so page reads cannot flood the agent context.
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_MAX_CHARS;
  return Math.max(500, Math.min(HARD_MAX_CHARS, n));
}

export function timeoutMs(value: unknown): number {
  // Bound command timeouts; very small/large values tend to create bad tool behavior.
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
  return Math.max(500, Math.min(60000, n));
}

export function oneLine(value: string, max = 140): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1))}…`;
}

export function truncate(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, Math.max(0, maxChars - 80))}\n\n[truncated ${value.length - maxChars} chars]`,
    truncated: true,
  };
}

let browserOverride: "chrome" | "zen" | "firefox" | undefined;

export function setBrowserOverride(kind: "chrome" | "zen" | "firefox" | undefined): void {
  browserOverride = kind;
}

export function browserKind(): "chrome" | "zen" | "firefox" {
  const configured = (browserOverride || process.env.PI_BROWSER || "chrome").toLowerCase();
  return configured === "zen" || configured === "firefox" ? configured : "chrome";
}

export function browserUrl(kind = browserKind()): string {
  return (
    kind === "chrome"
      ? process.env.PI_BROWSER_URL || DEFAULT_BROWSER_URL
      : process.env.PI_ZEN_BROWSER_URL || DEFAULT_ZEN_BROWSER_URL
  ).replace(/\/$/, "");
}

export function jsString(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

export function contentText(content: unknown): string {
  // Pi messages can be strings or structured content parts; normalize for prompt checks.
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : typeof part === "object" && part && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
    )
    .join("\n");
}
