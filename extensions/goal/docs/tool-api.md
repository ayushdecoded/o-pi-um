# Goal tool API

The model-facing `goal` tool only mutates durable goal state.

Setup:

```ts
goal({ contract: "approved contract text" });
```

Execution:

```ts
goal({ action: "subtask", subtasks: [{ subtask: "Run tests", completed: true }] });
goal({ action: "expand", expansions: { add: ["Follow-up objective"] } });
goal({ action: "pause" });
goal({ action: "complete" });
```

There is no `continue` action. Slice scheduling is owned by the extension controller.
