# Goal lifecycle

The goal extension is a lean Pi-tree slice runner.

## State

Goal state lives in session custom entries of type `pi-goal-state`.

These entries do not enter LLM context. The active goal is reconstructed by scanning the current session branch and taking the latest goal snapshot. There is no sidecar JSON store.

Important events:

- `created`
- `contract-approved`
- `tasks-updated`
- `completion-requested`
- `paused`
- `resumed`
- `completed`
- `slice-start`
- `slice-rolled-up`
- `cleared`

## Flow

```text
/goal <intent>
  -> append created snapshot
  -> send visible setup card
  -> model calls goal(contract=..., slices=[...])
  -> user approves contract
  -> append contract-approved snapshot with ordered slice plan
  -> start visible slice
  -> model updates current-slice tasks with name/objective/verification/evidence
  -> setup slice plan is consumed one slice at a time
  -> controller checks current slice tasks
  -> if slice tasks are all done, navigateTree(sliceStartId, { summarize: true })
  -> Pi appends branch_summary under slice-start
  -> append slice-rolled-up snapshot under the summary leaf
  -> if completion was requested, append completed only after that rollup
  -> otherwise start the next queued slice plan, or a default slice if none is queued
  -> repeat until paused/complete
```

Tree shape after a slice:

```text
s01 slice-start
  ├── detailed work branch
  │   └── visible slice card + assistant/tool/goal updates
  └── ✓ s01 branch_summary
      └── goal slice-rolled-up snapshot   ← active branch
```

## Current workaround

Pi currently exposes tree navigation through command context. `/goal` stores a guarded per-session command context, and post-turn auto-run reuses it until Pi exposes a cleaner hook API. The controller uses generation/shutdown guards so stale async work cannot append state after session replacement.

- `pi.appendEntry(...)` for durable state snapshots
- `ctx.sessionManager.getLeafId()` to recover the ID after append
- `pi.sendMessage(..., { display: true, triggerTurn: true })` for visible setup/work-order turns
- `ctx.waitForIdle()`/idle polling to wait for each agent turn
- current-slice tasks, capped at 7, as deterministic slice settlement; completed tasks must have evidence
- `ctx.navigateTree(sliceStartId, { summarize: true })` to roll up finished slices
- a tiny `tool_call` guard that blocks non-Goal tools between setup approval and the next visible slice work order
- a resume guard that refuses to inject a duplicate work order when the session leaf is already a Goal work order, unresolved assistant tool call, or unprocessed tool result
- `session_before_tree` to replace default branch wording with compact work-segment summaries using the `Compaction` model route

## Future Pi API swap

When Pi exposes tree navigation to normal extension hooks, remove retained command context and keep the same state model.
