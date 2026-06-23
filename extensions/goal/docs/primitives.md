# Goal primitives

The implementation intentionally uses Pi-native primitives:

- session custom entries: durable branch-local goal snapshots, not sent to the model
- visible custom messages: setup and slice work orders, rendered compactly but auditable/expandable
- command context: temporary access to `waitForIdle()` and `navigateTree()`
- current-slice tasks: `name`, `objective`, `verification`, optional completion `evidence`, capped at 7
- queued future slice plans: `name`, `objective`, consumed one at a time by the controller
- branch summaries: slice rollups
- labels/session names: readable `/tree` anchors

Usage/cost accounting must distinguish active branch from cumulative ledger:

- `ctx.sessionManager.getBranch()` follows the current tree leaf and matches active context/footer semantics after rollups.
- `ctx.sessionManager.getEntries()` scans all persisted entries, including abandoned detailed slice branches, and is closer to cumulative spend.

When Pi exposes branch summarization to normal extension contexts, the same primitives can move from command-controller orchestration to an `agent_end` runner.
