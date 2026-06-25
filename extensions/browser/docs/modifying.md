# Modifying browser

Keep the model-facing surface small: `action`, `target`, `text`.

## Rules

- Do not add aliases like `url`, `ref`, `query`, `key`, or `options`.
- Prefer internal defaults over model-controlled knobs.
- Put discovery in `snapshot`; keep `read` for text extraction.
- Actions that change page state should return a post-action snapshot when useful.
- Keep Chrome and BiDi behavior aligned.
- Snapshot refs must fail closed when stale; do not fall back from stale `e12` to a different element.

## Add or change an action

1. Update the action enum in:

```text
schema.ts
types.ts
```

2. Implement Chrome behavior in:

```text
actions/chrome.ts
```

3. Implement Zen/Firefox behavior in:

```text
actions/bidi.ts
```

4. Route the action in both backend dispatch switches.

5. If the action returns image bytes, handle it in:

```text
actions.ts
index.ts
```

## Change snapshot/ref behavior

Edit:

```text
dom.ts
```

Important pieces:

- `snapshotExpression()` builds the page-side snapshot script.
- `FIND_ELEMENT_JS` resolves `target=e12`, visible text, and `css:` selectors.
- `renderSnapshot()` controls model-facing text output.

Keep `snapshotExpression()` and `FIND_ELEMENT_JS` candidate ordering/signatures aligned. If they diverge, `target=e12` may click a different element than the snapshot showed instead of returning `stale_or_not_found`.

## Change browser launch behavior

Edit:

```text
launch.ts
constants.ts
utils.ts
```

Current defaults:

```text
Chrome:      http://127.0.0.1:9223
Zen/Firefox: http://127.0.0.1:9224
```

Chrome uses a dedicated profile under `~/.pi/browser-profile`. Zen/Firefox uses the normal profile with BiDi remote debugging flags, so mutating tool actions must stay guarded by UI confirmation or `PI_BROWSER_REAL_PROFILE_WRITE=1`.

## Change protocol behavior

Edit:

```text
primitives/cdp.ts
primitives/bidi.ts
primitives/session.ts
primitives/tabs.ts
```

Keep protocol clients minimal: connect, send command, pair responses by id, close cleanly.

## Checks

```text
npm run check
```

Smoke test pattern:

```text
open https://example.com
snapshot
click target e1
```
