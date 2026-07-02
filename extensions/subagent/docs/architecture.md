# Architecture

```text
index.ts        extension wiring and tool dispatch
runner.ts       orchestration: solo, parallel, follow-up, active-run tracking
pi-runner.ts    one tmux-backed Pi child run
models.ts       .pi/MODELS.md parsing and route resolution
usage.ts        input/output token and cost extraction

primitives/
  session.ts    ids, paths, session-file normalization
  system.ts     shell quoting, command execution, safe reads
  tmux.ts       tmux start/wait/kill
  pi-json.ts    Pi JSON stream parsing
```

Flow:

```text
subagent tool -> runner -> pi-runner -> primitives
```

Fresh runs create child session files under `~/.pi/agent/subagent-sessions`.
Follow-ups reuse the provided `sessionFiles` entries.
Run artifacts live under `~/.pi/agent/subagent-sessions/runs/<run-id>`.
