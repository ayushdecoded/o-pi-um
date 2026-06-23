# Goal tool API

The model-facing `goal` tool only mutates durable goal state.

Setup:

```ts
goal({ contract: "approved contract text" });
```

Execution:

```ts
goal({
  action: "tasks",
  slice: { name: "source indexing", objective: "build and validate source manifest" },
  slices: [
    { name: "final compile", objective: "build the final de-duplicated dataset" },
    { name: "web export", objective: "ship the local page and PDF export flow" },
  ],
  tasks: [
    {
      name: "Validate manifest",
      objective: "prove included/excluded sources are accounted for",
      verification: "run manifest validator",
      completed: true,
      evidence: "manifest validator passed",
    },
  ],
});
goal({ action: "pause" });
goal({ action: "complete" });
```

`tasks` updates the current slice in bulk. `slices` appends/updates queued future slice plans in bulk; the controller still owns when each slice starts.

There is no `continue` or model-facing scope expansion action. Slice scheduling is owned by the extension controller and every controller work order is visible in the transcript.
