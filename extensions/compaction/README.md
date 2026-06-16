# compaction

Routed model selection for Pi compaction.

## Behavior

- Pi owns compaction timing through native `compaction` settings.
- This extension intercepts `session_before_compact`.
- It runs Pi's built-in summarizer with the `.pi/MODELS.md` `Compaction` route.
- If the route or auth is unavailable, Pi's default compaction path is used.

## Model route

```markdown
## Compaction

model: provider/id
thinking: medium
```

## Native trigger settings

Use Pi settings for when compaction runs:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 54400,
    "keepRecentTokens": 20000
  }
}
```

For a 272k context window, `reserveTokens: 54400` triggers around 80%.
