// Thin protocol router. Public API stays action/target/text; this file chooses the
// backend-specific implementation and handles the one multimodal action: screenshot.
import { HARD_MAX_CHARS } from "./constants.ts";
import type { BrowserParams } from "./types.ts";
import { browserKind } from "./utils.ts";
import { bidiEvalValue, evalPage, withBidiTab, withTab } from "./session.ts";
import { runBidiBrowserAction } from "./actions/bidi.ts";
import { runChromeBrowserAction } from "./actions/chrome.ts";

// BiDi and CDP expose screenshots through different protocol commands.
async function captureBidiScreenshot(
  params: BrowserParams,
): Promise<{ text: string; data: string }> {
  return withBidiTab(params, async ({ tab, bidi }) => {
    const result = await bidi.send("browsingContext.captureScreenshot", {
      context: tab.id,
      origin: "viewport",
    });
    const data = String(result.data ?? "");
    return { text: `Screenshot captured (${Math.round(data.length * 0.75)} bytes PNG).`, data };
  });
}

export async function captureScreenshot(
  params: BrowserParams,
): Promise<{ text: string; data: string }> {
  // Keep screenshot handling here because Pi needs image bytes, not just text.
  if (browserKind() !== "chrome") return captureBidiScreenshot(params);
  return withTab(params, async ({ cdp }) => {
    const result = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const data = String(result.data ?? "");
    return { text: `Screenshot captured (${Math.round(data.length * 0.75)} bytes PNG).`, data };
  });
}

export async function runBrowserAction(params: BrowserParams): Promise<string> {
  // Most actions have protocol-specific implementations behind the same tool API.
  if (browserKind() !== "chrome") return runBidiBrowserAction(params);
  return runChromeBrowserAction(params);
}
