# Goal prompts

The extension uses visible custom messages as the work orders:

- setup card: clarify contract, then call `goal({ contract })` after approval
- slice card: approved contract, current slice, queued future slices, current tasks, and simple task rules

There is no hidden continuation prompt and no hidden controller work. The command controller schedules visible slices and Pi tree summaries roll them up.
