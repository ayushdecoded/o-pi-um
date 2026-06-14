# Goal tool API

## Setup

```ts
goal({ contract: string })
```

Only valid while no contract has been approved.

## Actions

```ts
goal({ action: "subtask", subtasks: Array<{ subtask: string; completed?: boolean }> })
goal({ action: "expand", expansions: { add?: string[]; drop?: number } })
goal({ action: "pause" })
goal({ action: "continue" })
goal({ action: "complete" })
```

## Rules

- `contract` is setup-only and cannot be mixed with `action`.
- `complete` is blocked until current-objective subtasks are complete.
- `expand.add` appends objectives.
- `expand.drop` removes an objective by index; index `0` is protected.
- `continue` queues the next loop turn without changing scope.
