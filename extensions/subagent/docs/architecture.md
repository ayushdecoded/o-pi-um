# Architecture

```text
index.ts        extension wiring and tool dispatch
runner.ts       orchestration: fan-out, follow-up, active-run tracking
pi-runner.ts    one Pi child run in tmux
models.ts       .pi/MODELS.md parsing and route resolution
usage.ts        input/output token and cost extraction

primitives/
  session.ts    ids, paths, session-file normalization
  system.ts     shell quoting, command execution, safe reads
  tmux.ts       tmux start/wait/kill
  pi-json.ts    Pi JSON stream parsing
```

Higher-level files compose primitives; primitives do not know about the tool schema or UI.
