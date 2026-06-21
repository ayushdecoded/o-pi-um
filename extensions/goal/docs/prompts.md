# Goal prompts

The extension uses three small prompts:

- setup prompt: clarify contract, then call `goal({ contract })` after approval
- ambient goal frame: approved contract, current objective, checklist
- slice work order: do one coherent work slice, update goal state, pause/complete when appropriate

No prompt asks the model to continue a loop. The command controller schedules slices and Pi tree summaries roll them up.
