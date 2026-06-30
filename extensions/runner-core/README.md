# Runner core

Small reusable layer between native Pi and features like Goal/RoboPi.

## Responsibility

Core manages:

- compact branch-local run entries in the Pi session file
- approved work plans as dependency graphs
- deterministic next-ready task selection
- task evidence validation
- pause/resume/complete transitions
- unit rollup boundaries
- default command/tool/controller plumbing that runners can override piecemeal

Core does not manage:

- UI rendering
- GitHub/worktrees
- feature-specific wording
- model-visible scheduler/meta prompts

## Model behavior

After setup, the model should see a focused work packet only:

```text
Implement merge precedence for config sources.

Objective:
Apply deterministic precedence: defaults < project < user < env.

Done when:
Validation confirms later sources override earlier sources.

Context:
- ConfigSource model already exists.
```

Tool definitions teach the protocol:

```ts
goal({ action: "approve", contract, plan });
goal({ action: "evidence", id, result: "complete", evidence });
goal({ action: "evidence", id, result: "failed", evidence });
```

If progress is invalid, core rejects with a specific message such as `Completed task t3 needs evidence.` Complete evidence marks the task done; failed evidence pauses the run with the model-provided reason.

## Feature shape

A feature defines one `RunnerDefinition`:

```ts
const goalRunner = {
  id: "goal",
  label: "Goal",
  command: { name: "goal" },
  tool: { name: "goal" },
  setupPrompt: goalSetupPrompt,
  workPrompt: goalWorkPrompt,
  rollupPrompt: goalRollupPrompt,
  policy: { maxTasksPerUnit: 10 },
};
```

Run entries are compact facts, not full snapshots: created, plan-approved, task-assigned, task-evidence, unit-rolled-up, paused, resumed, completed, cleared.

Customization stays narrow and composable:

- `registerRunner(pi, definition, { command:false })` lets a feature own slash commands while reusing tool/controller state.
- `command.actions` adds or overrides slash-command actions.
- `tool.actions` adds model-facing actions.
- `workflow` swaps scheduler policy decisions.
- `hooks` attach feature side effects to durable transitions.

RoboPi can remain a thin definition until it has real external behavior. Worktree/GitHub behavior should stay outside core.
