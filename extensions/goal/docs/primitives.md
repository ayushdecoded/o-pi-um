# Primitives

## Objective

An approved contract item. The model works one objective at a time.

## Subtask

A checklist item scoped to an objective index.

## Expansion

Additional objectives appended to the objective list.

## Blocker

A deterministic pause reason:

- `waiting_on_user`
- `budget_limited`

## Budget

Optional limits for tokens, elapsed time, turns, and cost.

## Continuation

A queued follow-up that wakes the assistant for the next loop turn.
