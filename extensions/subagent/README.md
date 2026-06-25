# subagent

Tmux-backed Pi child sessions for delegated work.

## Tool

```ts
subagent({
  tasks?: string[],
  sessionFile?: string,
  options?: { model?: string; reasoning?: string; timeout?: number },
})
```

## Behavior

- `tasks: ["..."]` starts one child Pi session.
- `tasks: ["...", "..."]` runs independent child sessions in parallel.
- `sessionFile` plus exactly one task sends a follow-up to an existing child session under `~/.pi/agent/subagent-sessions`.
- Child sessions live under `~/.pi/agent/subagent-sessions`.
- Run logs live under `~/.pi/agent/subagent-sessions/runs/<run-id>`.
- Requires `tmux`.
- Max active children: 10.
- Max nesting depth: 2.
- Results include status, output, session file, input/output token usage, and cost when available.
- Parent wait timeout defaults to 10 minutes; set `options.timeout` in minutes, `-1` to wait indefinitely, or `PI_SUBAGENT_TIMEOUT_MINUTES` globally. Timed-out children keep running in tmux and count as active until they exit.

## Commands

- `/agents` shows active subagent details.

## Model routes

- `/models` or `/models status` validates `.pi/MODELS.md`.
- `/models setup` drafts `.pi/MODELS.md` (`setup`, `bootstrap`, and `status` autocomplete).
- `model` may be an exact `provider/id` or a `.pi/MODELS.md` section name.

## Code layout

- `runner.ts` orchestrates runs.
- `pi-runner.ts` executes one child Pi run.
- `primitives/` contains tmux, path, process, and JSON-stream helpers.
