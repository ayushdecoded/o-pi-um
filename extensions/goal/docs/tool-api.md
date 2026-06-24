# Goal tool API

The model-facing `goal` tool only mutates durable goal state.

Setup:

```ts
goal({
  contract: "approved contract text",
  slices: [
    {
      name: "source indexing",
      objective: "build and validate source manifest",
      tasks: [
        {
          name: "Validate manifest",
          objective: "prove included/excluded sources are accounted for",
          verification: "run manifest validator",
        },
      ],
    },
  ],
});
```

Execution:

```ts
goal({
  action: "tasks",
  slice: { name: "source indexing", objective: "build and validate source manifest" },
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

`slices` is the ordered setup plan. `tasks` updates the current slice in bulk. `complete` on an active slice records `completion-requested`; the controller rolls up that slice first and appends `completed` only after the rollup. The controller owns when each slice starts.

There is no `continue` or model-facing scope expansion action. Slice scheduling is owned by the extension controller and every controller work order is visible in the transcript.
