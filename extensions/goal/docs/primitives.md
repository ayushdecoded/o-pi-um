# Goal primitives

The implementation intentionally uses Pi-native primitives:

- session custom entries: durable branch-local goal snapshots, not sent to the model
- visible custom messages: setup and slice work orders, rendered compactly but auditable/expandable
- command context: retained for the active Goal so normal post-turn auto-runs can still use `waitForIdle()` and `navigateTree()`
- current-slice tasks: `name`, `objective`, `verification`, optional completion `evidence`, capped at 7
- queued setup slice plans: `name`, optional `objective`, and planned tasks, consumed one at a time by the controller
- branch summaries: compact work-segment rollups generated with the `Compaction` model route
- labels/session names: readable `/tree` anchors

Usage/cost accounting must distinguish active branch from cumulative ledger:

- `ctx.sessionManager.getBranch()` follows the current tree leaf and matches active context/footer semantics after rollups.
- `ctx.sessionManager.getEntries()` scans all persisted entries, including abandoned detailed slice branches, and is closer to cumulative spend.

When Pi exposes tree navigation to normal extension contexts, the retained command-context workaround can be removed.
