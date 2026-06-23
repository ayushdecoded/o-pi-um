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

There is no `continue` or model-facing scope expansion action. Slice scheduling is owned by the extension controller and every controller work order is visible in the transcript.
