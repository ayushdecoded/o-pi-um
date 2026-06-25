# Browser tool API

The model-facing API is intentionally small.

```ts
browser({
  action?: "state" | "tabs" | "open" | "snapshot" | "read" | "click" | "type" | "press" | "scroll" | "wait" | "screenshot",
  target?: string,
  text?: string,
})
```

No other params are accepted.

## Actions

| Action       | Target                                            | Text          | Result                                                  |
| ------------ | ------------------------------------------------- | ------------- | ------------------------------------------------------- |
| `snapshot`   | empty                                             | empty         | compact page state and element refs                     |
| `open`       | URL                                               | empty         | opens a new tab                                         |
| `click`      | ref like `e12`, visible text, or `css:selector`   | empty         | clicks and returns post-action snapshot                 |
| `type`       | ref like `e12`, visible text, or `css:selector`   | value to type | types and returns post-action snapshot                  |
| `press`      | key or shortcut, e.g. `Enter`, `Escape`, `ctrl+a` | empty         | presses key and returns post-action snapshot            |
| `scroll`     | `up` or `down`                                    | empty         | scrolls a fixed amount and returns post-action snapshot |
| `wait`       | text to wait for, or empty for pause              | empty         | waits and returns post-wait snapshot                    |
| `read`       | empty or `css:selector`                           | empty         | full text extraction                                    |
| `screenshot` | empty                                             | empty         | text plus PNG image                                     |
| `state`      | empty                                             | empty         | backend endpoint and tab count                          |
| `tabs`       | empty                                             | empty         | tab list                                                |

## Intended loop

```json
{ "action": "snapshot" }
```

Then:

```json
{ "action": "click", "target": "e12" }
```

For typing:

```json
{ "action": "type", "target": "e2", "text": "hello" }
```

Refs are snapshot-bound. If the page changes or the ref no longer matches, click/type returns `stale_or_not_found`; take a fresh snapshot and retry with a fresh ref.

## Escape hatch

Prefer refs. Use CSS only when snapshot refs are insufficient:

```json
{ "action": "click", "target": "css:button.submit" }
```

## Hidden policy

The model cannot set browser URL, timeout, tab id, max output, selector, scroll amount, or backend through tool params. Those are internal defaults/env policy.

Chrome uses an isolated automation profile. Zen/Firefox use the real profile, so `open`, `click`, `type`, and `press` require UI confirmation or `PI_BROWSER_REAL_PROFILE_WRITE=1`.
