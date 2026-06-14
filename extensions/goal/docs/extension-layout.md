# Extension layout

```text
core/
  index.ts      hooks and registration
  commands.ts   slash commands
  actions.ts    goal action handlers
  runtime.ts    process-local loop state
  tool.ts       model-facing tool

domain/
  constants.ts
  intent.ts
  state.ts
  types.ts

runtime/
  analysis.ts   usage, budget, message analysis
  store.ts      durable goal state

prompt/
  prompts.ts

ui/
  dashboard.ts
  overlays.ts
  status.ts
  statusline.ts
  text.ts
  format.ts
```

Model routing and subagent execution live in `extensions/subagent`.
