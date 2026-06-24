# Goal prompts

The extension uses visible custom messages as the work orders:

- setup card: clarify only unresolved plan branches one question at a time, then call `goal({ contract, slices })` after approval and reply with one short handoff line only
- slice card: approved contract, current slice, queued setup slices, current tasks, and simple task rules

There is no hidden continuation prompt and no hidden controller work. The controller schedules visible slices and compact tree summaries roll them up.
