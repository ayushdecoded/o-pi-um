# Browser architecture

The browser extension exposes one lean `browser` tool backed by Chrome DevTools Protocol for Chrome and WebDriver BiDi for Zen/Firefox.

## Layout

```text
index.ts              extension registration, commands, tool schema wiring
actions.ts            backend dispatch and screenshot result handling
actions/chrome.ts     Chrome/CDP action implementations
actions/bidi.ts       Zen/Firefox BiDi action implementations
schema.ts             public action/target/text schema
types.ts              public params and internal protocol/snapshot types
constants.ts          default ports, browser candidates, profile paths
utils.ts              output limits, browser selection, text helpers
launch.ts             browser discovery, launch, endpoint readiness
key.ts                key/shortcut normalization for CDP and BiDi
dom.ts                snapshot generation, element lookup, snapshot rendering
session.ts            public facade for browser primitives

primitives/
  cdp.ts              minimal CDP websocket client and page evaluation
  bidi.ts             minimal WebDriver BiDi client and page evaluation
  tabs.ts             tab/context listing, selection, activation, blank tab creation
  session.ts          lifecycle wrappers: connect, choose tab, run action, close
  http.ts             small JSON fetch helper
```

## Flow

```text
browser tool
  -> index.ts validates action/target/text
  -> actions.ts chooses Chrome or BiDi
  -> actions/<backend>.ts performs action
  -> primitives/session.ts owns connection lifecycle
  -> primitives/cdp.ts or primitives/bidi.ts sends protocol messages
```

## Backend choice

Chrome is the fallback backend and uses an isolated profile. Zen/Firefox is selected when the latest user message explicitly contains `zen`, when Zen is already open, when the Zen BiDi endpoint is reachable, or by `PI_BROWSER=zen|firefox`; writes to that real profile are confirmation-gated unless `PI_BROWSER_REAL_PROFILE_WRITE=1` is set. Use `PI_BROWSER=chrome` to force Chrome.

Browser endpoints are internal policy:

```text
Chrome:      http://127.0.0.1:9223
Zen/Firefox: http://127.0.0.1:9224
```

## Snapshot model

`snapshot` is the primary inspection action. It returns compact page state and refs:

```text
Page: Example Domain
URL: https://example.com/
Summary: ...
Elements:
[e1] link "Learn more" — href=https://iana.org/domains/example
```

Action refs are regenerated from visible interactive elements in DOM order. The intended loop is:

```text
snapshot -> click/type target=eN -> receive post-action snapshot
```

Refs should be used soon after the snapshot that produced them.
