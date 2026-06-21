# Goal lifecycle

The goal extension is a lean Pi-tree slice runner.

## State

Goal state lives in session custom entries of type `pi-goal-state`.

These entries do not enter LLM context. The active goal is reconstructed by scanning the current session branch and taking the latest goal snapshot. There is no sidecar JSON store.

Important events:

- `created`
- `contract-approved`
- `subtasks-updated`
- `expanded`
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
  -> send hidden setup message
  -> model calls goal(contract=...)
  -> user approves contract
  -> append contract-approved snapshot
  -> start slice
  -> send hidden work-order message
  -> wait for idle
  -> controller seeds one slice subtask
  -> controller checks current slice subtasks
  -> if slice subtasks are all done, navigateTree(sliceStartId, { summarize: true })
  -> Pi appends branch_summary under slice-start
  -> append slice-rolled-up snapshot under the summary leaf
  -> repeat until paused/complete
```

Tree shape after a slice:

```text
goal-slice-start
  ├── detailed work branch
  │   └── assistant/tool/goal updates
  └── branch_summary
      └── goal slice-rolled-up snapshot   ← active branch
```

## Current workaround

Pi currently exposes branch summarization through command context, so `/goal` and `/goal resume` run the controller. The controller uses:

- `pi.appendEntry(...)` for durable state snapshots
- `ctx.sessionManager.getLeafId()` to recover the ID after append
- `pi.sendMessage(..., { triggerTurn: true })` for hidden setup/work-order turns
- `ctx.waitForIdle()` to wait for each agent turn
- current-slice subtasks, capped at 7, as deterministic slice settlement
- `ctx.navigateTree(sliceStartId, { summarize: true })` to roll up finished slices

## Future Pi API swap

When Pi exposes branch summarization to normal extension hooks, move slice rollup from the command controller to `agent_end` and keep the same state model.
