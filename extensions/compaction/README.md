# compaction

Automatic context compaction policy for Pi.

## Behavior

- Checks context usage after each agent loop.
- Triggers compaction when context usage reaches 80%.
- Uses the `Compaction` route from `.pi/MODELS.md`.
- Falls back to Pi's default compaction model if the route or auth is unavailable.

## Model route

```markdown
## Compaction

model: provider/id
thinking: medium
```

The route is parsed by the subagent model-routing helpers. `thinking` is passed to Pi's built-in compaction summarizer.

## Code layout

```text
index.ts    threshold check, compaction hook, routed model selection
```

The extension does not implement its own summarizer. It calls Pi's built-in `compact()` with the routed model.
