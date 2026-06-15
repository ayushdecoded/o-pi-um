import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BROWSER_URL = "http://127.0.0.1:9223";
export const DEFAULT_ZEN_BROWSER_URL = "http://127.0.0.1:9224";
export const DEFAULT_MAX_CHARS = 8000;
export const HARD_MAX_CHARS = 30000;
export const DEFAULT_TIMEOUT_MS = 7000;
export const CHROME_PROFILE_DIR = join(homedir(), ".pi", "browser-profile");
export const CHROME_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
];
export const ZEN_CANDIDATES = ["zen-browser", "zen", "zen-bin"];
export const FIREFOX_CANDIDATES = ["firefox", "firefox-developer-edition"];
export const AUTO_LAUNCH_ENV = "PI_BROWSER_AUTO_LAUNCH";
