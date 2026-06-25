# Goal commands

- `/goal <intent>` starts setup and then runs the slice controller after approval.
- `/goal status` shows the current branch's goal snapshot.
- `/goal pause` appends a paused snapshot.
- `/goal resume` manually resumes after an explicit pause/blocker; normal approved work auto-runs. It refuses to add another work order if the session leaf already has a queued Goal turn, unresolved tool call, or unprocessed tool result.
- `/goal clear` appends a clear event on the current branch.
- `/goal` autocompletes `status`, `help`, `pause`, `resume`, `clear`, and `cancel`.

There is no `/goal_mode` and no `/goal_model`. Goal state is branch-local session state.
