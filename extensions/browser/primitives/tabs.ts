import { ensureBrowserRunning } from "../launch.ts";
import type { BrowserParams, ChromeTab } from "../types.ts";
import { fetchJson } from "./http.ts";
import { BidiClient, bidiEvalValue } from "./bidi.ts";

// Chrome exposes tab metadata through the /json endpoints before we attach CDP.
export async function listTabs(params: BrowserParams, baseUrl: string): Promise<ChromeTab[]> {
  await ensureBrowserRunning(baseUrl);
  const tabs = await fetchJson<ChromeTab[]>(`${baseUrl}/json/list`);
  return tabs.filter((tab) => tab.type === "page" && tab.webSocketDebuggerUrl);
}

export function chooseTab(tabs: ChromeTab[], tabRef?: string | number): ChromeTab | undefined {
  // Accept numeric indexes, exact ids, or fuzzy title/url fragments for options.tab.
  if (tabs.length === 0) return undefined;
  if (tabRef === undefined || tabRef === null || tabRef === "") return tabs[0];
  if (typeof tabRef === "number") return tabs[Math.max(0, Math.min(tabs.length - 1, tabRef))];
  const key = String(tabRef).toLowerCase();
  const numeric = Number.parseInt(key, 10);
  if (Number.isFinite(numeric) && String(numeric) === key)
    return tabs[Math.max(0, Math.min(tabs.length - 1, numeric))];
  return (
    tabs.find((tab) => tab.id === tabRef) ??
    tabs.find(
      (tab) =>
        (tab.title ?? "").toLowerCase().includes(key) ||
        (tab.url ?? "").toLowerCase().includes(key),
    )
  );
}

export async function activateTab(baseUrl: string, tab: ChromeTab): Promise<void> {
  // Activation is best-effort; automation can still work if the browser rejects it.
  try {
    await fetch(`${baseUrl}/json/activate/${encodeURIComponent(tab.id)}`);
  } catch {}
}

export async function bidiListTabs(bidi: BidiClient): Promise<ChromeTab[]> {
  // BiDi calls top-level browsing contexts "tabs"; fetch titles separately from DOM.
  const tree = await bidi.send("browsingContext.getTree", {});
  const contexts: any[] = tree.contexts ?? [];
  const topLevel = contexts.filter((ctx) => !ctx.parent);
  const tabs: ChromeTab[] = [];
  for (const ctx of topLevel) {
    let title = "";
    try {
      title = (await bidiEvalValue<string>(bidi, ctx.context, "document.title", 2500)) ?? "";
    } catch {}
    tabs.push({ id: String(ctx.context), type: "page", title, url: String(ctx.url ?? "") });
  }
  return tabs;
}

export function chooseBidiTab(tabs: ChromeTab[], tabRef?: string | number): ChromeTab | undefined {
  // Without an explicit tab, prefer a real page over browser/newtab/internal pages.
  if (tabRef !== undefined && tabRef !== null && tabRef !== "") return chooseTab(tabs, tabRef);
  return (
    tabs.find((tab) => tab.url && !/^(about:blank|about:newtab|moz-extension:)/i.test(tab.url)) ??
    tabs[0]
  );
}

export async function activateBidiTab(bidi: BidiClient, tab: ChromeTab): Promise<void> {
  try {
    await bidi.send("browsingContext.activate", { context: tab.id }, 2500);
  } catch {}
}

export async function openBlankTab(baseUrl: string): Promise<void> {
  // Chrome changed /json/new from GET to PUT; support both endpoint variants.
  try {
    await fetchJson<ChromeTab>(`${baseUrl}/json/new?${encodeURIComponent("about:blank")}`, {
      method: "PUT",
    });
  } catch {
    await fetchJson<ChromeTab>(`${baseUrl}/json/new?${encodeURIComponent("about:blank")}`);
  }
}
