import type { BrowserParams, BrowserSnapshot } from "../types.ts";
import { browserUrl, jsString, oneLine, truncate } from "../utils.ts";
import { FIND_ELEMENT_JS, renderSnapshot, snapshotExpression } from "../dom.ts";
import { bidiKeySequence } from "../key.ts";
import {
  bidiEvalJson,
  bidiEvalValue,
  bidiListTabs,
  chooseBidiTab,
  withBidiSession,
  withBidiTab,
} from "../session.ts";

// Same public API as Chrome: action + target + text. These helpers decode target
// into ref/css/text without exposing backend-specific params to the model.
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

async function bidiActionOpen(params: BrowserParams): Promise<string> {
  // BiDi has no /json/new endpoint, so opening means creating a browsing context.
  const url = params.target || params.text;
  if (!url) return "browser.open requires target=<url>.";
  return withBidiSession(params, async ({ bidi, timeout }) => {
    const created = await bidi.send("browsingContext.create", { type: "tab" }, timeout);
    const context = String(created.context);
    await bidi.send("browsingContext.navigate", { context, url, wait: "none" }, timeout);
    try {
      await bidi.send("browsingContext.activate", { context }, 2500);
    } catch {}
    return `Opened tab ${context}: ${url}`;
  });
}

async function bidiActionTabs(params: BrowserParams): Promise<string> {
  return withBidiSession(params, async ({ baseUrl, bidi }) => {
    const tabs = await bidiListTabs(bidi);
    if (tabs.length === 0) return `No debuggable Zen/Firefox tabs at ${baseUrl}.`;
    return tabs
      .map(
        (tab, index) =>
          `[${index}] ${oneLine(tab.title || "Untitled", 80)}\n    id=${tab.id} url=${oneLine(tab.url || "", 160)}`,
      )
      .join("\n");
  });
}

async function bidiActionState(params: BrowserParams): Promise<string> {
  try {
    return await withBidiSession(params, async ({ baseUrl, bidi }) => {
      const caps = bidi.capabilities ?? {};
      const browser = caps.browserName
        ? `Browser: ${caps.browserName}${caps.browserVersion ? ` ${caps.browserVersion}` : ""}\n`
        : "";
      const profile = caps["moz:profile"] ? `Profile: ${caps["moz:profile"]}\n` : "";
      const tabs = await bidiListTabs(bidi);
      return `${browser}${profile}Endpoint: ${baseUrl} (WebDriver BiDi)\nTabs: ${tabs.length}\n${tabs
        .slice(0, 12)
        .map(
          (tab, index) =>
            `[${index}] ${oneLine(tab.title || "Untitled", 70)} — ${oneLine(tab.url || "", 120)}`,
        )
        .join("\n")}`;
    });
  } catch (error) {
    const baseUrl = browserUrl();
    return `Zen/Firefox bridge not reachable at ${baseUrl}. Quit existing Zen instances that were started without remote debugging, then run /zen-start or retry. ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function bidiActionSnapshot(params: BrowserParams): Promise<string> {
  // Reuse the exact same in-page snapshot script as Chrome for consistent refs.
  return withBidiTab(params, async ({ tab, bidi, maxChars }) => {
    const snapshot = await bidiEvalJson<BrowserSnapshot>(bidi, tab.id, snapshotExpression());
    return renderSnapshot(snapshot, maxChars);
  });
}

async function bidiActionRead(params: BrowserParams): Promise<string> {
  // Full page or css:selector text only. Interactive discovery belongs to snapshot.
  return withBidiTab(params, async ({ tab, bidi, maxChars }) => {
    const selector = params.target?.startsWith("css:") ? params.target.slice(4) : undefined;
    const value = await bidiEvalJson<{ title: string; url: string; text: string }>(
      bidi,
      tab.id,
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

async function bidiActionClick(params: BrowserParams): Promise<string> {
  // Prefer refs from snapshot. Fuzzy text is kept as a convenience, but failure text
  // nudges the model back to snapshot -> ref instead of selector guessing.
  return withBidiTab(params, async ({ tab, bidi, timeout, maxChars }) => {
    const result = await bidiEvalJson<any>(
      bidi,
      tab.id,
      `(() => {
			${FIND_ELEMENT_JS}
			const el = __piFindElement(${jsString(targetRef(params))}, ${jsString(targetText(params))}, ${jsString(targetSelector(params))}, false);
			if (!el) return { ok: false, message: 'not_found: no matching clickable element. Call snapshot and retry with a ref like e12.' };
			const label = __piLabelFor(el).replace(/\s+/g, ' ').trim();
			el.scrollIntoView({ block: 'center', inline: 'center' });
			el.click();
			return { ok: true, label, tag: el.tagName.toLowerCase() };
		})()`,
      timeout,
    );
    if (!result.ok) return result.message;
    const snapshot = await bidiEvalJson<BrowserSnapshot>(
      bidi,
      tab.id,
      snapshotExpression(30, 1000),
      timeout,
    );
    return `Clicked ${result.tag}${result.label ? `: ${oneLine(result.label)}` : ""}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function bidiActionType(params: BrowserParams): Promise<string> {
  // Set DOM value directly and fire input/change so React/Vue/etc. notice the update.
  return withBidiTab(params, async ({ tab, bidi, timeout, maxChars }) => {
    const value = params.text ?? "";
    const result = await bidiEvalJson<any>(
      bidi,
      tab.id,
      `(() => {
			${FIND_ELEMENT_JS}
			const el = __piFindElement(${jsString(targetRef(params))}, ${jsString(targetText(params))}, ${jsString(targetSelector(params))}, true);
			if (!el) return { ok: false, message: 'not_found: no matching input field. Call snapshot and retry with a ref like e12.' };
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
    const snapshot = await bidiEvalJson<BrowserSnapshot>(
      bidi,
      tab.id,
      snapshotExpression(30, 1000),
      timeout,
    );
    return `Typed into ${result.tag}${result.label ? `: ${oneLine(result.label)}` : ""}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function bidiActionPress(params: BrowserParams): Promise<string> {
  // Convert friendly key strings like ctrl+a into WebDriver private-use key values.
  return withBidiTab(params, async ({ tab, bidi, timeout, maxChars }) => {
    const key = params.target || params.text || "Enter";
    const keys = bidiKeySequence(key);
    await bidi.send(
      "input.performActions",
      {
        context: tab.id,
        actions: [
          {
            type: "key",
            id: "keyboard",
            actions: [
              ...keys.map((value) => ({ type: "keyDown", value })),
              ...[...keys].reverse().map((value) => ({ type: "keyUp", value })),
            ],
          },
        ],
      },
      timeout,
    );
    try {
      await bidi.send("input.releaseActions", { context: tab.id }, 2500);
    } catch {}
    const snapshot = await bidiEvalJson<BrowserSnapshot>(
      bidi,
      tab.id,
      snapshotExpression(25, 800),
      timeout,
    );
    return `Pressed ${key}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function bidiActionScroll(params: BrowserParams): Promise<string> {
  // Public API is only target=up/down; amount is deliberately fixed for predictability.
  return withBidiTab(params, async ({ tab, bidi, maxChars, timeout }) => {
    const amount = 700;
    const direction = params.target?.toLowerCase().includes("up") ? "up" : "down";
    const delta = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
    const value = await bidiEvalJson<{ x: number; y: number; height: number }>(
      bidi,
      tab.id,
      `(() => { window.scrollBy(0, ${delta}); return { x: scrollX, y: scrollY, height: document.documentElement.scrollHeight }; })()`,
      timeout,
    );
    const snapshot = await bidiEvalJson<BrowserSnapshot>(
      bidi,
      tab.id,
      snapshotExpression(30, 1000),
      timeout,
    );
    return `Scrolled ${direction}. Position: ${Math.round(value.y)}/${Math.round(value.height)}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
async function bidiActionWait(params: BrowserParams): Promise<string> {
  // Always return post-wait state; plain "Waited" caused low-signal retry loops.
  return withBidiTab(params, async ({ tab, bidi, timeout, maxChars }) => {
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
        const found = await bidiEvalValue<boolean>(
          bidi,
          tab.id,
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
    const snapshot = await bidiEvalJson<BrowserSnapshot>(
      bidi,
      tab.id,
      snapshotExpression(30, 1000),
      timeout,
    );
    return `Wait ${status}${target ? `: ${target}` : ""}

${renderSnapshot(snapshot, maxChars)}`;
  });
}
export async function runBidiBrowserAction(params: BrowserParams): Promise<string> {
  // A simple switch is easier to audit than dynamic dispatch, and keeps unsupported
  // actions harmless by falling back to state.
  const action = (params.action ?? "state").toLowerCase();
  switch (action) {
    case "open":
      return bidiActionOpen(params);
    case "tabs":
      return bidiActionTabs(params);
    case "snapshot":
      return bidiActionSnapshot(params);
    case "read":
      return bidiActionRead(params);
    case "click":
      return bidiActionClick(params);
    case "type":
      return bidiActionType(params);
    case "press":
      return bidiActionPress(params);
    case "scroll":
      return bidiActionScroll(params);
    case "wait":
      return bidiActionWait(params);
    case "state":
    default:
      return bidiActionState(params);
  }
}
