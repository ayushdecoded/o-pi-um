import type { BrowserElement, BrowserSnapshot } from "./types.ts";
import { oneLine, truncate } from "./utils.ts";

// Snapshots are the model-facing representation of the page. Keep them small enough
// for context, but rich enough that the model can choose refs without reading raw DOM.
export const DEFAULT_SNAPSHOT_ELEMENTS = 40;
export const DEFAULT_SNAPSHOT_TEXT = 1800;

// Builds a self-contained function string that runs inside the page. We keep this as
// browser-side JavaScript so CDP and BiDi can share the same snapshot behavior.
export function snapshotExpression(
  maxElements = DEFAULT_SNAPSHOT_ELEMENTS,
  textLimit = DEFAULT_SNAPSHOT_TEXT,
): string {
  return `(() => {
    const maxElements = ${Math.max(1, maxElements)};
    const textLimit = ${Math.max(200, textLimit)};
    const norm = s => String(s || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    // Infer common accessibility roles when the page did not provide an explicit role.
    // This mirrors the agent-facing shape used by Playwright MCP: role + name + ref.
    const roleOf = el => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        if (['checkbox'].includes(type)) return 'checkbox';
        if (['radio'].includes(type)) return 'radio';
        return 'textbox';
      }
      if (el.isContentEditable) return 'textbox';
      if (tag === 'summary') return 'button';
      return tag;
    };
    // Accessible-ish name extraction. Order matters: author-provided labels beat
    // visible text because they are usually shorter and more stable.
    const labelFor = el => {
      const id = el.getAttribute('id');
      const labelledBy = el.getAttribute('aria-labelledby');
      const byId = labelledBy ? labelledBy.split(/\s+/).map(x => document.getElementById(x)?.innerText || '').join(' ') : '';
      const label = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]')?.innerText || '' : '';
      return norm([
        el.getAttribute('aria-label'),
        byId,
        label,
        el.getAttribute('title'),
        el.getAttribute('placeholder'),
        el.getAttribute('name'),
        el.innerText,
        el.value,
      ].filter(Boolean).join(' '));
    };
    // The selector is not exposed as a primary API, but it is useful internally for
    // debugging and for the css: escape hatch when refs are not enough.
    const selectorFor = el => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      for (let cur = el; cur && cur.nodeType === 1 && parts.length < 4; cur = cur.parentElement) {
        const tag = cur.tagName.toLowerCase();
        const parent = cur.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const same = Array.from(parent.children).filter(x => x.tagName === cur.tagName);
        const index = same.indexOf(cur) + 1;
        parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
      }
      return parts.join(' > ');
    };
    // Only include things the user/model can plausibly interact with. This keeps refs
    // dense and reduces false choices from decorative DOM nodes.
    const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role],[tabindex],[contenteditable="true"],summary,label'))
      .filter(visible)
      .filter(el => !el.closest('[aria-hidden="true"]'));
    const seen = new Set();
    const elements = [];
    for (const el of candidates) {
      const role = roleOf(el);
      const name = labelFor(el);
      // De-dupe repeated framework wrappers so one visible control usually becomes one ref.
      const key = role + '|' + name + '|' + (el.href || '') + '|' + selectorFor(el);
      if (seen.has(key)) continue;
      seen.add(key);
      const rect = el.getBoundingClientRect();
      elements.push({
        ref: 'e' + (elements.length + 1),
        role,
        name: name || role,
        tag: el.tagName.toLowerCase(),
        value: 'value' in el ? String(el.value || '').slice(0, 120) : '',
        href: el.href || '',
        selector: selectorFor(el),
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        selected: Boolean(el.checked || el.selected || el.getAttribute('aria-selected') === 'true'),
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      });
      if (elements.length >= maxElements) break;
    }
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).slice(0, 12)
      .map(h => ({ level: Number(h.tagName.slice(1)), text: norm(h.innerText) })).filter(h => h.text);
    const text = norm(document.body?.innerText || '').slice(0, textLimit);
    const active = document.activeElement && document.activeElement !== document.body ? labelFor(document.activeElement) : '';
    return { title: document.title, url: location.href, text, headings, elements, focused: active };
  })()`;
}

// Injected before click/type actions. It intentionally uses the same candidate order
// as snapshotExpression, so target=e12 means "the twelfth thing the snapshot showed".
export const FIND_ELEMENT_JS = `
function __piVisible(el) {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}
function __piNorm(s) { return String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
function __piLabelFor(el) {
  const id = el.getAttribute('id');
  const labelledBy = el.getAttribute('aria-labelledby');
  const byId = labelledBy ? labelledBy.split(/\s+/).map(x => document.getElementById(x)?.innerText || '').join(' ') : '';
  const label = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]')?.innerText || '' : '';
  return [el.getAttribute('aria-label'), byId, label, el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('name'), el.innerText, el.value].filter(Boolean).join(' ');
}
function __piCandidates(fieldsOnly) {
  const tags = fieldsOnly ? 'input, textarea, select, [contenteditable="true"], [role="textbox"]' : 'a,button,input,textarea,select,[role="button"],[role="link"],[tabindex],[contenteditable="true"],summary,label';
  const seen = new Set();
  return Array.from(document.querySelectorAll(tags)).filter(__piVisible).filter(el => !el.closest('[aria-hidden="true"]')).filter(el => {
    const key = el.tagName + '|' + __piNorm(__piLabelFor(el)) + '|' + (el.href || '') + '|' + (el.id || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function __piFindElement(ref, target, selector, fieldsOnly) {
  // Resolution priority: explicit css: selector, snapshot ref, then fuzzy visible label.
  if (selector) {
    const selected = document.querySelector(selector);
    if (selected) return selected;
  }
  const candidates = __piCandidates(fieldsOnly);
  if (ref && /^e\d+$/i.test(ref)) return candidates[Number(ref.slice(1)) - 1];
  const q = __piNorm(target);
  if (!q) return document.activeElement && document.activeElement !== document.body ? document.activeElement : candidates[0];
  return candidates.find(el => __piNorm(__piLabelFor(el)) === q)
    || candidates.find(el => __piNorm(__piLabelFor(el)).includes(q))
    || candidates.find(el => __piNorm(el.outerHTML).includes(q));
}
`;

// Render as compact text instead of JSON because LLMs scan this shape reliably, while
// the [eN] refs are still regular enough to call tools deterministically.
export function renderSnapshot(snapshot: BrowserSnapshot, maxChars: number): string {
  const heading = snapshot.headings?.length
    ? `\nHeadings: ${snapshot.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join(" | ")}`
    : "";
  const focused = snapshot.focused ? `\nFocused: ${oneLine(snapshot.focused, 120)}` : "";
  const elements = snapshot.elements.length
    ? `\nElements:\n${snapshot.elements.map(renderElement).join("\n")}`
    : "\nElements: none visible";
  const body = `Page: ${snapshot.title || "Untitled"}\nURL: ${snapshot.url}${heading}${focused}\nSummary: ${snapshot.text || ""}${elements}`;
  return truncate(body, maxChars).text;
}

// One line per element prevents giant nested output and makes refs visually prominent.
export function renderElement(element: BrowserElement): string {
  const flags = [element.disabled ? "disabled" : "", element.selected ? "selected" : ""]
    .filter(Boolean)
    .join(",");
  const suffix = [
    element.value ? `value=${JSON.stringify(oneLine(element.value, 60))}` : "",
    element.href ? `href=${oneLine(element.href, 90)}` : "",
    flags,
  ]
    .filter(Boolean)
    .join(" ");
  return `[${element.ref}] ${element.role} ${JSON.stringify(oneLine(element.name || element.role, 100))}${suffix ? ` — ${suffix}` : ""}`;
}
