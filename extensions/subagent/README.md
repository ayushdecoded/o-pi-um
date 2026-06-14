# subagent

Tmux-backed Pi child sessions for delegated work.

## Tool

```ts
subagent({
  task?: string,
  tasks?: Array<{ task: string; model?: string; reasoning?: string }>,
  sessionFile?: string,
  options?: { model?: string; reasoning?: string },
})
```

## Behavior

- `task` starts one child Pi session.
- `tasks` runs independent child sessions in parallel.
- `sessionFile` plus `task` sends a follow-up to an existing child session.
- Child sessions live under `~/.pi/agent/subagent-sessions`.
- Run logs live under `~/.pi/agent/subagent-sessions/runs/<run-id>`.
- Max active children: 10.
- Max nesting depth: 2.
- Results include status, output, session file, input/output token usage, and cost when available.

## Model routes

- `/models` validates `.pi/MODELS.md`.
- `/models setup` drafts `.pi/MODELS.md`.
- `model` may be an exact `provider/id` or a `.pi/MODELS.md` section name.

## Code layout

- `runner.ts` orchestrates runs.
- `pi-runner.ts` executes one child Pi run.
- `primitives/` contains tmux, path, process, and JSON-stream helpers.
