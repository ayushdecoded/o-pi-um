# Model routing

`.pi/MODELS.md` maps task classes to models. Subagent owns parsing and validation; the compaction extension also reuses the `Compaction` route.

## Commands

```text
/models
/models setup
/models bootstrap
```

## Sections

```text
Planning
Complex coding
Medium coding
Exploration
Quick edits
Design
Compaction
```

## Section format

```text
## Quick edits
model: provider/id
thinking: low
secondary_model: provider/id
secondary_thinking: minimal
```

Required fields: `model`, `thinking`.

Optional fields: `secondary_model`, `secondary_thinking`.

Valid thinking values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

## Compaction route

The `compaction` extension uses:

```text
## Compaction
model: provider/id
thinking: medium
```

When context reaches 80%, it triggers Pi compaction and runs Pi's built-in summarizer with this routed model.
