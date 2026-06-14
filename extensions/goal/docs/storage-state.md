# Storage and state

Goal state is stored per Pi thread under the session goal directory.

## Durable fields

- intent
- objectives
- current objective index
- status
- blockers
- budgets
- usage totals
- subtasks
- goal model override

## Runtime fields

Process-local runtime tracks active timers, queued continuations, current turn usage, active sub-turns, and stale follow-up guards.

## Boundaries

- Goal state owns goal lifecycle only.
- Subagent sessions are separate Pi session files.
- `.pi/MODELS.md` is owned by the subagent/system extension.
- UI overlay data is process-local and not persisted in goal state.
