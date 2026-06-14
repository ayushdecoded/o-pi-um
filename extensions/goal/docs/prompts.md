# Prompts

Goal prompts are small loop prompts, not planning documents.

## Setup prompt

Asks the assistant to clarify the user intent and call `goal({ contract })` once success criteria, boundaries, validation, and ask-before constraints are clear.

## Continuation prompt

Shows:

- active objective
- current checklist
- blockers
- budget pressure
- compact recovery note when present

The prompt does not expose loop mechanics or stale lifecycle state.

## Compaction recovery

After compaction, the extension queues one continuation with the compaction summary as orientation.
