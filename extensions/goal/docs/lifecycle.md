# Goal lifecycle

The goal extension is a lean Pi-tree slice runner.

## State

Goal state lives in session custom entries of type `pi-goal-state`.

These entries do not enter LLM context. The active goal is reconstructed by scanning the current session branch and taking the latest goal snapshot. There is no sidecar JSON store.

Important events:

- `created`
- `contract-approved`
- `tasks-updated`
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
  -> model calls goal(contract=...)
  -> user approves contract
  -> append contract-approved snapshot
  -> start visible slice
  -> model updates current-slice tasks with name/objective/verification/evidence
  -> model may queue future slice plans with name/objective in bulk
  -> controller checks current slice tasks
  -> if slice tasks are all done, navigateTree(sliceStartId, { summarize: true })
  -> Pi appends branch_summary under slice-start
  -> append slice-rolled-up snapshot under the summary leaf
  -> start the next queued slice plan, or a default slice if none is queued
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

Pi currently exposes branch summarization through command context, so `/goal` and `/goal resume` run the controller. The controller uses:

- `pi.appendEntry(...)` for durable state snapshots
- `ctx.sessionManager.getLeafId()` to recover the ID after append
- `pi.sendMessage(..., { display: true, triggerTurn: true })` for visible setup/work-order turns
- `ctx.waitForIdle()`/idle polling to wait for each agent turn
- current-slice tasks, capped at 7, as deterministic slice settlement
- `ctx.navigateTree(sliceStartId, { summarize: true })` to roll up finished slices

## Future Pi API swap

When Pi exposes branch summarization to normal extension hooks, move slice rollup from the command controller to `agent_end` and keep the same state model.
