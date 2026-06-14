# Hooks and accounting

## Session start

Restores the goal dashboard and queues resume continuations for active idle goals.

## Context

Filters stale setup and continuation follow-ups using message metadata and current goal state.

## Agent start

Resets per-turn counters:

- tool calls
- sub-turn usage
- live token estimate
- subagent usage
- active continuation id

## Tool completion

Counts tool calls. Completed `subagent` results add child input/output token totals and child cost to the current goal turn.

## Turn end

Records provider usage for each assistant sub-turn.

## Agent end

Persists elapsed time, parent model usage, subagent usage, cost, turn count, sub-turns, blockers, and budget state.

Cache hit rate is not adjusted for subagents; child input/output tokens are included in goal usage totals.
