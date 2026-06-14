# Model routing

`.pi/MODELS.md` maps task classes to models.

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
