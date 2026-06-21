# Goal primitives

The implementation intentionally uses Pi-native primitives:

- session custom entries: durable branch-local goal snapshots
- hidden custom messages: setup and slice work orders
- command context: temporary access to `waitForIdle()` and `navigateTree()`
- slice-scoped subtasks: deterministic settlement, seeded by the controller and capped at 7 per slice
- branch summaries: slice rollups
- labels: readable `/tree` anchors

Usage/cost accounting must distinguish active branch from cumulative ledger:

- `ctx.sessionManager.getBranch()` follows the current tree leaf and matches active context/footer semantics after rollups.
- `ctx.sessionManager.getEntries()` scans all persisted entries, including abandoned detailed slice branches, and is closer to cumulative spend.

When Pi exposes branch summarization to normal extension contexts, the same primitives can move from command-controller orchestration to an `agent_end` runner.
