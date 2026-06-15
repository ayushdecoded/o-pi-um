import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  AUTO_LAUNCH_ENV,
  CHROME_CANDIDATES,
  CHROME_PROFILE_DIR,
  DEFAULT_BROWSER_URL,
  DEFAULT_ZEN_BROWSER_URL,
  FIREFOX_CANDIDATES,
  ZEN_CANDIDATES,
} from "./constants.ts";
import type { LaunchSpec } from "./types.ts";
import { browserKind } from "./utils.ts";

// One in-flight launch per backend prevents concurrent tool calls from spawning duplicates.
let launchPromise: Promise<void> | undefined;
let zenLaunchPromise: Promise<void> | undefined;

export function autoLaunchEnabled(): boolean {
  // Auto-launch is on by default; operators can opt out for externally managed browsers.
  return !/^(0|false|no|off)$/i.test(process.env[AUTO_LAUNCH_ENV] ?? "");
}

function commandExists(cmd: string): boolean {
  return (
    spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${cmd}`], { encoding: "utf8" }).status ===
    0
  );
}

function flatpakZenAvailable(): boolean {
  return (
    commandExists("flatpak") &&
    spawnSync("flatpak", ["info", "app.zen_browser.zen"], { encoding: "utf8" }).status === 0
  );
}

function browserLaunchSpec(kind: "chrome" | "zen" | "firefox"): LaunchSpec | undefined {
  // Prefer explicit env vars, then common executable names, then Zen's Flatpak install.
  if (kind === "chrome") {
    if (process.env.PI_CHROME_BIN) return { command: process.env.PI_CHROME_BIN };
    const command = CHROME_CANDIDATES.find(commandExists);
    return command ? { command } : undefined;
  }
  if (kind === "firefox") {
    if (process.env.PI_FIREFOX_BIN) return { command: process.env.PI_FIREFOX_BIN };
    const command = FIREFOX_CANDIDATES.find(commandExists);
    return command ? { command } : undefined;
  }
  if (process.env.PI_ZEN_BIN) return { command: process.env.PI_ZEN_BIN };
  const zenCommand = ZEN_CANDIDATES.find(commandExists);
  if (zenCommand) return { command: zenCommand };
  if (flatpakZenAvailable())
    return {
      command: "flatpak",
      argsPrefix: ["run", "--command=/app/zen/zen", "app.zen_browser.zen"],
    };
  if (process.env.PI_FIREFOX_BIN) return { command: process.env.PI_FIREFOX_BIN };
  const firefoxCommand = FIREFOX_CANDIDATES.find(commandExists);
  return firefoxCommand ? { command: firefoxCommand } : undefined;
}

function browserPort(baseUrl: string): number {
  try {
    return Number.parseInt(new URL(baseUrl).port || "9222", 10) || 9222;
  } catch {
    return 9222;
  }
}

export async function chromeEndpointReachable(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/json/version`)).ok;
  } catch {
    return false;
  }
}

export async function bidiEndpointReachable(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/`)).ok;
  } catch {
    return false;
  }
}

async function waitForEndpoint(
  baseUrl: string,
  timeoutMsValue = 7000,
  label = "Browser",
  checker = chromeEndpointReachable,
): Promise<void> {
  // Browser processes return immediately; poll until the automation endpoint is ready.
  const start = Date.now();
  while (Date.now() - start < timeoutMsValue) {
    if (await checker(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not expose automation at ${baseUrl} within ${timeoutMsValue}ms`);
}

export async function ensureChromeRunning(baseUrl = DEFAULT_BROWSER_URL): Promise<void> {
  if (!autoLaunchEnabled()) return;
  if (await chromeEndpointReachable(baseUrl)) return;
  if (launchPromise) return launchPromise;
  launchPromise = (async () => {
    const spec = browserLaunchSpec("chrome");
    if (!spec)
      throw new Error(
        "Google Chrome was not found. Install google-chrome-stable or set PI_CHROME_BIN.",
      );
    // Chrome gets a dedicated profile so automation does not disturb the user's main profile.
    mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
    const port = browserPort(baseUrl);
    const args = [
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${CHROME_PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--new-window",
      "about:blank",
    ];
    const proc = spawn(spec.command, [...(spec.argsPrefix ?? []), ...args], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    await waitForEndpoint(baseUrl, 9000, "Chrome", chromeEndpointReachable);
  })().finally(() => {
    launchPromise = undefined;
  });
  return launchPromise;
}

export async function ensureZenRunning(
  baseUrl = DEFAULT_ZEN_BROWSER_URL,
  kind: "zen" | "firefox" = "zen",
): Promise<void> {
  if (!autoLaunchEnabled()) return;
  if (await bidiEndpointReachable(baseUrl)) return;
  if (zenLaunchPromise) return zenLaunchPromise;
  zenLaunchPromise = (async () => {
    const spec = browserLaunchSpec(kind);
    if (!spec)
      throw new Error(
        `${kind === "zen" ? "Zen" : "Firefox"} was not found. Install Zen/Firefox, or set PI_ZEN_BIN / PI_FIREFOX_BIN.`,
      );
    const port = browserPort(baseUrl);
    // Zen/Firefox use the user's normal profile; we only add the BiDi remote endpoint flags.
    const args = [
      `--remote-debugging-port=${port}`,
      "--remote-allow-hosts=127.0.0.1",
      "--remote-allow-origins=*",
    ];
    const proc = spawn(spec.command, [...(spec.argsPrefix ?? []), ...args], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    await waitForEndpoint(baseUrl, 12000, "Zen/Firefox", bidiEndpointReachable);
  })().finally(() => {
    zenLaunchPromise = undefined;
  });
  return zenLaunchPromise;
}

export async function ensureBrowserRunning(baseUrl: string): Promise<void> {
  const kind = browserKind();
  if (kind === "chrome") return ensureChromeRunning(baseUrl);
  return ensureZenRunning(baseUrl, kind);
}
