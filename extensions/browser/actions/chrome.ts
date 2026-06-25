import type { BrowserParams, BrowserSnapshot, ChromeTab } from "../types.ts";
import { ensureBrowserRunning } from "../launch.ts";
import { browserKind, browserUrl, jsString, oneLine, truncate } from "../utils.ts";
import { FIND_ELEMENT_JS, renderSnapshot, snapshotExpression } from "../dom.ts";
import { cdpKeySpec } from "../key.ts";
import { evalPage, fetchJson, listTabs, withTab } from "../session.ts";

// target is intentionally overloaded in the public API. These helpers decode it
// according to the action without exposing separate ref/query/selector params.
function targetRef(params: BrowserParams): string | undefined {
  return /^e\d+$/i.test(params.target ?? "") ? params.target : undefined;
}

function targetSelector(params: BrowserParams): string | undefined {
  return params.target?.startsWith("css:") ? params.target.slice(4) : undefined;
}

function targetText(params: BrowserParams): string | undefined {
  return /^e\d+$/i.test(params.target ?? "") || params.target?.startsWith("css:")
    ? undefined
    : params.target;
}

async function actionOpen(params: BrowserParams): Promise<string> {
  // Open always creates a new tab; tab selection is no longer model-facing state.
  const baseUrl = browserUrl();
  await ensureBrowserRunning(baseUrl);
  const url = params.target || params.text;
  if (!url) return "browser.open requires target=<url>.";
  let created: ChromeTab;
  try {
    created = await fetchJson<ChromeTab>(`${baseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
    });
  } catch {
    created = await fetchJson<ChromeTab>(`${baseUrl}/json/new?${encodeURIComponent(url)}`);
  }
  return `Opened tab ${created.id}: ${created.url ?? url}`;
}

async function actionTabs(params: BrowserParams): Promise<string> {
  const baseUrl = browserUrl();
  const tabs = await listTabs(params, baseUrl);
  if (tabs.length === 0) return `No debuggable tabs at ${baseUrl}.`;
  return tabs
    .map(
      (tab, index) =>
        `[${index}] ${oneLine(tab.title || "Untitled", 80)}\n    id=${tab.id} url=${oneLine(tab.url || "", 160)}`,
    )
    .join("\n");
}

async function actionState(params: BrowserParams): Promise<string> {
  const baseUrl = browserUrl();
  let version = "";
  try {
    await ensureBrowserRunning(baseUrl);
    const info = await fetchJson<{ Browser?: string }>(`${baseUrl}/json/version`);
    version = info.Browser ? `Browser: ${info.Browser}\n` : "";
  } catch (error) {
    return `${browserKind() === "chrome" ? "Chrome" : "Zen/Firefox"} bridge not reachable at ${baseUrl}. Start the browser with the configured remote debugging port, or set PI_CHROME_BIN / PI_ZEN_BIN. ${error instanceof Error ? error.message : String(error)}`;
  }
  const tabs = await listTabs(params, baseUrl);
  return `${version}Endpoint: ${baseUrl}\nTabs: ${tabs.length}\n${tabs
    .slice(0, 12)
    .map(
      (tab, index) =>
        `[${index}] ${oneLine(tab.title || "Untitled", 70)} — ${oneLine(tab.url || "", 120)}`,
    )
    .join("\n")}`;
}

async function actionSnapshot(params: BrowserParams): Promise<string> {
  // Primary inspection path: concise page text + interactive refs.
  return withTab(params, async ({ cdp, maxChars }) => {
    const snapshot = await evalPage<BrowserSnapshot>(cdp, snapshotExpression(), undefined);
    return renderSnapshot(snapshot, maxChars);
  });
}

async function actionRead(params: BrowserParams): Promise<string> {
  // Read is now only for full text extraction; discovery belongs to snapshot.
  return withTab(params, async ({ tab, cdp, maxChars }) => {
    const selector = params.target?.startsWith("css:") ? params.target.slice(4) : undefined;
    const value = await evalPage<{ title: string; url: string; text: string }>(
      cdp,
      `(() => {
        const selector = ${jsString(selector)};
        const root = selector ? document.querySelector(selector) : document.body;
        const text = root ? (root.innerText || root.textContent || '') : '';
        return { title: document.title, url: location.href, text };
      })()`,
    );
    const clipped = truncate((value.text ?? "").trim(), maxChars);
    return `Page: ${value.title || tab.title || "Untitled"}
URL: ${value.url || tab.url || ""}

${clipped.text}`;
  });
}

async function actionClick(params: BrowserParams): Promise<string> {
  // Prefer refs from snapshot. Fuzzy text is kept as a convenience, but failure text
  // nudges the model back to snapshot -> ref instead of selector guessing.
  return withTab(params, async ({ cdp, timeout, maxChars }) => {
    const result = await evalPage<any>(
      cdp,
      `(() => {
			${FIND_ELEMENT_JS}
			const el = __piFindElement(${jsString(targetRef(params))}, ${jsString(targetText(params))}, ${jsString(targetSelector(params))}, false);
			if (!el) return { ok: false, message: 'stale_or_not_found: target no longer matches the page. Call snapshot and retry with a fresh ref like e12.' };
			const label = __piLabelFor(el).replace(/\s+/g, ' ').trim();
			el.scrollIntoView({ block: 'center', inline: 'center' });
			el.click();
			return { ok: true, label, tag: el.tagName.toLowerCase() };
		})()`,
      timeout,
    );
    if (!result.ok) return result.message;
    // Let SPA navigation/state updates settle before returning the next page state.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const snapshot = await evalPage<BrowserSnapshot>(cdp, snapshotExpression(30, 1000), timeout);
    return `Clicked ${result.tag}${result.label ? `: ${oneLine(result.label)}` : ""}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function actionType(params: BrowserParams): Promise<string> {
  // Set DOM value directly and fire input/change so React/Vue/etc. notice the update.
  return withTab(params, async ({ cdp, timeout, maxChars }) => {
    const value = params.text ?? "";
    const result = await evalPage<any>(
      cdp,
      `(() => {
			${FIND_ELEMENT_JS}
			const el = __piFindElement(${jsString(targetRef(params))}, ${jsString(targetText(params))}, ${jsString(targetSelector(params))}, true);
			if (!el) return { ok: false, message: 'stale_or_not_found: input target no longer matches the page. Call snapshot and retry with a fresh ref like e12.' };
			const label = __piLabelFor(el).replace(/\s+/g, ' ').trim();
			el.scrollIntoView({ block: 'center', inline: 'center' });
			el.focus();
			const value = ${jsString(value)};
			if (el.isContentEditable) el.textContent = value;
			else if ('value' in el) el.value = value;
			else el.textContent = value;
			el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			return { ok: true, label, tag: el.tagName.toLowerCase() };
		})()`,
      timeout,
    );
    if (!result.ok) return result.message;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const snapshot = await evalPage<BrowserSnapshot>(cdp, snapshotExpression(30, 1000), timeout);
    return `Typed into ${result.tag}${result.label ? `: ${oneLine(result.label)}` : ""}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function actionPress(params: BrowserParams): Promise<string> {
  // Normalize shortcuts like ctrl+a so the model does not need CDP key syntax.
  return withTab(params, async ({ cdp, maxChars, timeout }) => {
    const key = params.target || params.text || "Enter";
    const spec = cdpKeySpec(key);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...spec }, timeout);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...spec }, timeout);
    const snapshot = await evalPage<BrowserSnapshot>(cdp, snapshotExpression(25, 800), timeout);
    return `Pressed ${key}\n\n${renderSnapshot(snapshot, maxChars)}`;
  });
}

async function actionScroll(params: BrowserParams): Promise<string> {
  // Public API is only target=up/down; amount is deliberately fixed for predictability.
  return withTab(params, async ({ cdp, maxChars, timeout }) => {
    const amount = 700;
    const direction = params.target?.toLowerCase().includes("up") ? "up" : "down";
    const delta = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
    const value = await evalPage<{ x: number; y: number; height: number }>(
      cdp,
      `(() => { window.scrollBy(0, ${delta}); return { x: scrollX, y: scrollY, height: document.documentElement.scrollHeight }; })()`,
      timeout,
    );
    const snapshot = await evalPage<BrowserSnapshot>(cdp, snapshotExpression(30, 1000), timeout);
    return `Scrolled ${direction}. Position: ${Math.round(value.y)}/${Math.round(value.height)}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function actionWait(params: BrowserParams): Promise<string> {
  // Always return post-wait state; plain "Waited" caused low-signal retry loops.
  return withTab(params, async ({ cdp, timeout, maxChars }) => {
    const target = params.target || params.text || "";
    const wait = 0;
    let status = "settled";
    if (!target) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(timeout, Math.max(250, wait || 1000))),
      );
    } else {
      status = "timeout";
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const found = await evalPage<boolean>(
          cdp,
          `document.body && document.body.innerText.toLowerCase().includes(${jsString(target.toLowerCase())})`,
          Math.min(2000, timeout),
        );
        if (found) {
          status = "found";
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    const snapshot = await evalPage<BrowserSnapshot>(cdp, snapshotExpression(30, 1000), timeout);
    return `Wait ${status}${target ? `: ${target}` : ""}\n\n${renderSnapshot(snapshot, maxChars)}`;
  });
}

export async function runChromeBrowserAction(params: BrowserParams): Promise<string> {
  // A simple switch is easier to audit than dynamic dispatch, and keeps unsupported
  // actions harmless by falling back to state.
  const action = (params.action ?? "state").toLowerCase();
  switch (action) {
    case "open":
      return actionOpen(params);
    case "tabs":
      return actionTabs(params);
    case "snapshot":
      return actionSnapshot(params);
    case "read":
      return actionRead(params);
    case "click":
      return actionClick(params);
    case "type":
      return actionType(params);
    case "press":
      return actionPress(params);
    case "scroll":
      return actionScroll(params);
    case "wait":
      return actionWait(params);
    case "state":
    default:
      return actionState(params);
  }
}
