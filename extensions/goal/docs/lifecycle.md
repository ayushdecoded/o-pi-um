# Goal lifecycle

A goal is a guarded loop around one approved contract.

## Setup

`/goal <intent>` creates paused state with no objectives. The assistant discusses scope and calls:

```ts
goal({ contract: "approved contract" });
```

The contract becomes objective `0`, the goal becomes active, and continuation begins.

## Active loop

Each continuation receives only the active objective, checklist, blockers, and budget pressure. The assistant updates progress with:

```ts
goal({ action: "subtask", subtasks: [{ subtask: "...", completed: true }] });
goal({ action: "expand", expansions: { add: ["..."] } });
goal({ action: "pause" });
goal({ action: "complete" });
```

## Pause and resume

Paused goals keep durable state. `/goal resume` clears blockers and queues the next continuation when the UI is idle.

## Completion

Completion requires all active-objective subtasks to be done. The extension records final usage and stops continuation.
