// Normalizes model-friendly key strings ("Enter", "ctrl+a", "ArrowDown") into
// the two protocol-specific representations used by CDP and WebDriver BiDi.
export type CdpKeySpec = {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers?: number;
};

// CDP encodes modifiers as a bitmask on each key event.
const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};
const CDP_SPECIAL: Record<string, CdpKeySpec> = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
};

// WebDriver BiDi follows the WebDriver private-use Unicode codes for special keys.
const BIDI_SPECIAL: Record<string, string> = {
  enter: "\uE007",
  tab: "\uE004",
  escape: "\uE00C",
  esc: "\uE00C",
  backspace: "\uE003",
  delete: "\uE017",
  arrowdown: "\uE015",
  arrowup: "\uE013",
  arrowleft: "\uE012",
  arrowright: "\uE014",
  ctrl: "\uE009",
  control: "\uE009",
  shift: "\uE008",
  alt: "\uE00A",
  option: "\uE00A",
  meta: "\uE03D",
  cmd: "\uE03D",
  command: "\uE03D",
};

function parts(key: string): string[] {
  // Accept common spellings: ctrl+a, ctrl a, and ctrl-a all mean the same thing.
  return key
    .split(/[+\s-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^arrow_?/, "arrow");
}

export function cdpKeySpec(raw: string): CdpKeySpec {
  // Only the final token is the actual key; earlier tokens are modifiers.
  const tokens = parts(raw || "Enter");
  const keyToken = normalizeToken(tokens.at(-1) ?? "enter");
  const modifiers = tokens
    .slice(0, -1)
    .reduce((sum, token) => sum | (MODIFIER_BITS[normalizeToken(token)] ?? 0), 0);
  const special = CDP_SPECIAL[keyToken];
  if (special) return { ...special, modifiers };
  const key = keyToken.length === 1 ? keyToken : raw;
  return {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    modifiers,
  };
}

export function bidiKeySequence(raw: string): string[] {
  // BiDi sends a sequence of keyDowns followed by reversed keyUps in the action layer.
  const tokens = parts(raw || "Enter").map(normalizeToken);
  if (tokens.length === 0) return [BIDI_SPECIAL.enter];
  return tokens.map((token) => BIDI_SPECIAL[token] ?? (token.length === 1 ? token : raw));
}
