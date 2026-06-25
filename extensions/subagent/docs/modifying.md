# Modifying subagent

The subagent extension runs real child Pi sessions in tmux. Keep the parent tool small and keep child transcripts in child session files.

## Public API

Edit public params in:

```text
schema.ts
types.ts
index.ts
```

Current model-facing shapes:

```ts
subagent({ task })
subagent({ tasks: [{ task, model?, reasoning? }] })
subagent({ sessionFile, task })
subagent({ options: { model?, reasoning? } })
```

Rules:

- `task` starts one fresh child session.
- `tasks` fans out independent fresh child sessions in parallel.
- `sessionFile + task` follows up an existing child session.
- Do not copy child transcripts into the parent; return `sessionFile` for follow-ups.

## Execution flow

```text
index.ts
  -> runner.ts
  -> pi-runner.ts
  -> primitives/session.ts, tmux.ts, pi-json.ts, system.ts
```

Responsibilities:

```text
index.ts        tool validation, dispatch, result rendering, commands registration
runner.ts       fan-out/follow-up orchestration, active run tracking, panel lifecycle
pi-runner.ts    one tmux-backed Pi invocation and artifact collection
models.ts       .pi/MODELS.md parsing, validation, route resolution
usage.ts        child token/cost aggregation
```

## Tmux runs

`pi-runner.ts` is the only file that launches Pi.

Each run creates artifacts under:

```text
~/.pi/agent/subagent-sessions/runs/<run-id>/
  run.sh
  stdout.jsonl
  stderr.log
  exit.status
```

The parent waits for `exit.status`. The child remains inspectable in tmux while running.

Important behavior:

- `run.sh` runs Pi in JSON mode.
- stdout is filtered to `session` and `message_end` events only.
- filtering prevents streaming `message_update` logs from growing without bound.
- `stderr.log` is preserved for failures.

## Timeout behavior

The parent wait timeout defaults to 10 minutes:

```text
PI_SUBAGENT_TIMEOUT_MINUTES=10
```

Per-call `timeout` is also in minutes; `timeout: -1` disables the parent wait timeout.

On timeout the tool returns failure text with:

```text
tmux attach -t <session>
```

Do not kill the tmux session on timeout; keeping it inspectable is intentional. Timed-out children keep their active-runtime slot until the tmux run writes its exit status. User cancellation does kill the tmux session.

## Session files

Session path helpers live in:

```text
primitives/session.ts
```

Fresh child sessions are stored under:

```text
~/.pi/agent/subagent-sessions
```

Follow-ups normalize the provided `sessionFile` path and only accept existing top-level subagent child JSONL files under `~/.pi/agent/subagent-sessions`.

## Model routing

Model routing is owned by subagent.

Files:

```text
models.ts
model-commands.ts
```

Commands:

```text
/models
/models status
/models setup
/models bootstrap
```

Route resolution order:

```text
exact provider/id
-> .pi/MODELS.md section name
-> fuzzy available model match
-> parent/default model
```

Required `.pi/MODELS.md` sections are listed in `REQUIRED_MODEL_SECTIONS`.

## Usage accounting

Child usage is extracted from child `message_end` records:

```text
pi-runner.ts -> readJsonMessages() -> usageFromMessages()
```

Goal accounting may consume this usage from subagent tool results. Keep usage fields stable:

```ts
{
  inputTokens,
  outputTokens,
  tokens,
  costUsd,
}
```

Cache hit rates are not adjusted for subagents.

## Parallelism and nesting

Limits live in:

```text
constants.ts
```

Current behavior:

```text
MAX_ACTIVE = 10
MAX_DEPTH = 2
```

`runner.ts` enforces nesting through `PI_SUBAGENT_DEPTH`.

## Checks

```text
npm run check
```

Smoke tests:

```text
subagent({ task: "say OK" })
subagent({ tasks: [{ task: "A" }, { task: "B" }] })
subagent({ sessionFile: "...", task: "what did you say?" })
```

For timeout behavior:

```text
PI_SUBAGENT_TIMEOUT_MINUTES=0.1
```
