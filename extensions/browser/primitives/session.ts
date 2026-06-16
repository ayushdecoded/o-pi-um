import { ensureZenRunning } from "../launch.ts";
import type { BrowserParams, ChromeTab } from "../types.ts";
import { browserKind, browserUrl, clampMaxChars, timeoutMs } from "../utils.ts";
import { BidiClient } from "./bidi.ts";
import { CdpClient } from "./cdp.ts";
import {
  activateBidiTab,
  activateTab,
  bidiListTabs,
  chooseBidiTab,
  chooseTab,
  listTabs,
  openBlankTab,
} from "./tabs.ts";

// Own the full BiDi lifecycle for callers: launch/connect, run, always close.
export async function withBidiSession<T>(
  params: BrowserParams,
  fn: (ctx: { baseUrl: string; bidi: BidiClient; maxChars: number; timeout: number }) => Promise<T>,
): Promise<T> {
  // The public tool no longer accepts browser params; backend choice comes from
  // environment/defaults plus deterministic Zen detection in the tool entrypoint.
  const kind = browserKind() === "firefox" ? "firefox" : "zen";
  const baseUrl = browserUrl(kind);
  await ensureZenRunning(baseUrl, kind);
  // Timeouts/output caps are fixed internal policy now, not model-controlled knobs.
  const timeout = timeoutMs(undefined);
  const bidi = new BidiClient(baseUrl, timeout);
  try {
    await bidi.connect();
    return await fn({
      baseUrl,
      bidi,
      maxChars: clampMaxChars(undefined),
      timeout,
    });
  } finally {
    await bidi.close();
  }
}

// Like withBidiSession, but also chooses or creates a target browsing context.
export async function withBidiTab<T>(
  params: BrowserParams,
  fn: (ctx: {
    baseUrl: string;
    tab: ChromeTab;
    bidi: BidiClient;
    maxChars: number;
    timeout: number;
  }) => Promise<T>,
): Promise<T> {
  return withBidiSession(params, async ({ baseUrl, bidi, maxChars, timeout }) => {
    let tabs = await bidiListTabs(bidi);
    // Without public tab selection, choose the first real page and avoid blank/newtab pages.
    let tab = chooseBidiTab(tabs);
    if (!tab) {
      // BiDi may start with no top-level contexts when launched headless/empty.
      const created = await bidi.send("browsingContext.create", { type: "tab" }, timeout);
      tab = { id: String(created.context), type: "page", title: "", url: "about:blank" };
      tabs = [tab];
    }
    await activateBidiTab(bidi, tab);
    return await fn({ baseUrl, tab, bidi, maxChars, timeout });
  });
}

// Chrome/CDP wrapper for actions that need one debuggable tab.
export async function withTab<T>(
  params: BrowserParams,
  fn: (ctx: {
    baseUrl: string;
    tab: ChromeTab;
    cdp: CdpClient;
    maxChars: number;
    timeout: number;
  }) => Promise<T>,
): Promise<T> {
  const baseUrl = browserUrl("chrome");
  const tabs = await listTabs(params, baseUrl);
  // Chrome actions attach to the active/first page. The model should not manage tab IDs.
  const tab = chooseTab(tabs);
  if (!tab?.webSocketDebuggerUrl) {
    // A fresh Chrome profile may only have non-debuggable shell pages; open a page tab.
    await openBlankTab(baseUrl);
    const refreshed = chooseTab(await listTabs(params, baseUrl));
    if (!refreshed?.webSocketDebuggerUrl)
      throw new Error(
        `No debuggable browser tab found at ${baseUrl}. Start the browser with the configured remote debugging port.`,
      );
    return withSpecificTab(params, refreshed, fn);
  }
  await activateTab(baseUrl, tab);
  const cdp = new CdpClient(tab.webSocketDebuggerUrl, timeoutMs(undefined));
  try {
    await cdp.connect();
    return await fn({
      baseUrl,
      tab,
      cdp,
      maxChars: clampMaxChars(undefined),
      timeout: timeoutMs(undefined),
    });
  } finally {
    cdp.close();
  }
}

// Attach to a known Chrome tab after withTab has created a blank fallback tab.
export async function withSpecificTab<T>(
  params: BrowserParams,
  tab: ChromeTab,
  fn: (ctx: {
    baseUrl: string;
    tab: ChromeTab;
    cdp: CdpClient;
    maxChars: number;
    timeout: number;
  }) => Promise<T>,
): Promise<T> {
  const baseUrl = browserUrl("chrome");
  await activateTab(baseUrl, tab);
  const cdp = new CdpClient(tab.webSocketDebuggerUrl!, timeoutMs(undefined));
  try {
    await cdp.connect();
    return await fn({
      baseUrl,
      tab,
      cdp,
      maxChars: clampMaxChars(undefined),
      timeout: timeoutMs(undefined),
    });
  } finally {
    cdp.close();
  }
}
