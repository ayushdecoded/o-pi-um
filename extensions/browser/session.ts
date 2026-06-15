// Public primitive facade: action modules import from here instead of individual files.
export { fetchJson } from "./primitives/http.ts";
export { CdpClient, evalPage } from "./primitives/cdp.ts";
export { BidiClient, bidiEvalJson, bidiEvalValue } from "./primitives/bidi.ts";
export {
  activateBidiTab,
  activateTab,
  bidiListTabs,
  chooseBidiTab,
  chooseTab,
  listTabs,
  openBlankTab,
} from "./primitives/tabs.ts";
export { withBidiSession, withBidiTab, withSpecificTab, withTab } from "./primitives/session.ts";
