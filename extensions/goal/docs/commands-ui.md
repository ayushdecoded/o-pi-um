# Goal commands

- `/goal <intent>` starts setup and then runs the slice controller after approval.
- `/goal status` shows the current branch's goal snapshot.
- `/goal pause` appends a paused snapshot.
- `/goal resume` resumes setup or execution and restarts the command-context controller.
- `/goal clear` appends a clear event on the current branch.
- `/agents` shows active subagent details.

There is no `/goal_mode` and no `/goal_model`. Goal state is branch-local session state.
