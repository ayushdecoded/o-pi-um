# Goal extension layout

- `core/index.ts` wires the tool, commands, and lightweight hooks.
- `core/controller.ts` runs the command-context slice loop.
- `core/actions.ts` implements model tool mutations.
- `core/commands.ts` implements `/goal` and `/agents`.
- `domain/state.ts` reconstructs and appends branch-local goal snapshots.
- `domain/types.ts` defines the lean goal/slice state.
- `prompt/prompts.ts` contains setup, frame, work-order, and summary prompts.
- `ui/*` contains minimal approval/status helpers.

Deleted by design: sidecar store, continuation runtime, budget accounting, goal mode/model toggles.
