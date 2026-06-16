# Commands and UI

## Commands

```text
/goal <intent> [--token-budget N] [--time-budget 10m] [--turn-budget N] [--cost-budget 0.25]
/goal status
/goal pause
/goal resume
/goal expand <objective>
/goal expand-drop <index>
/goal clear
/goal_mode on|off|status
/goal_model
/agents
```

`/goal_mode off` removes the `goal` tool from active tools, so goal schema and guidance are not included in the model prompt. `/goal_mode on` restores it.

## Dashboard

The dashboard shows:

- goal status
- active objective
- checklist progress
- elapsed time
- token usage
- budget blockers
- active subagents

## Subagents

`/agents` reads process-local subagent dashboard data and shows active child runs. Subagent session files remain outside goal state.

## Model routes

Use `/models` and `/models setup` from the subagent extension for `.pi/MODELS.md`.
