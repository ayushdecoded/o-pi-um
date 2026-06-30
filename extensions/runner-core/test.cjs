const assert = require("node:assert/strict");
const jiti = require("jiti")(process.cwd() + "/extensions/runner-core/test.cjs");

const { createRun, approvePlan, startNextWork, updateTask, rollUpUnit } = jiti("./transitions.ts");
const { readRun, readFeatureEvents, RUNNER_ENTRY_TYPE } = jiti("./store.ts");
const { runStatusText } = jiti("./format.ts");
const { registerRunnerTool } = jiti("./tool.ts");
const { registerRunnerCommand } = jiti("./command.ts");
const { activateRunnerTool, clearRunnerTool, rememberRunnerTool } = jiti("./tool-scope.ts");
const { runRunnerController, turnInProgressReason } = jiti("./controller.ts");
const { Type } = require("typebox");

const definition = {
  id: "goal",
  label: "Goal",
  command: { name: "goal" },
  tool: { name: "goal" },
  setupPrompt: () => "",
  workPrompt: () => "",
  policy: { maxTasksPerUnit: 10 },
};

function plan() {
  return {
    contract: "contract",
    units: [
      {
        id: "s1",
        name: "Slice 1",
        objective: "Objective",
        dependsOn: [],
        tasks: [
          {
            id: "t1",
            name: "Task 1",
            objective: "Objective",
            verification: "Verify",
            dependsOn: [],
          },
        ],
      },
    ],
  };
}

function entry(id, kind, runId, data = {}) {
  return { id, type: "custom", customType: RUNNER_ENTRY_TYPE, data: eventData(kind, runId, data) };
}

function eventData(kind, runId, data = {}) {
  return {
    version: 1,
    scope: "core",
    runnerId: "goal",
    runId,
    timestamp: 1,
    event: event(kind, data),
  };
}

function event(kind, data = {}) {
  if (kind === "created")
    return { type: "run.created", intent: data.intent ?? "intent", metadata: data.metadata };
  if (kind === "plan-approved") return { type: "plan.approved", plan: data.plan };
  if (kind === "task-assigned")
    return { type: "task.assigned", unitId: data.unitId, taskId: data.taskId };
  if (kind === "task-evidence")
    return {
      type: "task.reported",
      taskId: data.taskId,
      result: "complete",
      evidence: data.evidence,
    };
  if (kind === "task-failed")
    return {
      type: "task.reported",
      taskId: data.taskId,
      result: "failed",
      evidence: data.evidence,
    };
  if (kind === "unit-rolled-up")
    return {
      type: "unit.rolled_up",
      unitId: data.unitId,
      summaryEntryId: data.summaryEntryId,
      summary: data.summary,
    };
  if (kind === "paused")
    return { type: "run.paused", reason: data.reason ?? "blocked", detail: data.detail };
  if (kind === "resumed") return { type: "run.resumed" };
  if (kind === "completed") return { type: "run.completed" };
  if (kind === "cleared") return { type: "run.cleared" };
  throw new Error(`unknown event kind ${kind}`);
}

(async () => {
  {
    let activeTools = ["bash", "goal", "robopi"];
    const pi = {
      getActiveTools: () => activeTools,
      setActiveTools: (tools) => (activeTools = tools),
    };
    const ctx = { ui: { notify() {} } };
    rememberRunnerTool(definition);
    rememberRunnerTool({ ...definition, id: "robopi", tool: { name: "robopi" } });
    activateRunnerTool(pi, ctx, definition);
    assert.deepEqual(activeTools, ["bash", "goal"]);
    clearRunnerTool(pi, ctx, definition);
    assert.deepEqual(activeTools, ["bash"]);
  }

  {
    const imported = plan();
    imported.units[0].tasks[0].evidence = "should be reset";
    const approved = approvePlan(createRun(definition, "intent"), definition, imported);
    assert.equal(approved.ok, true);
    assert.equal(approved.value.plan.units[0].tasks[0].evidence, undefined);
  }

  {
    let run = approvePlan(createRun(definition, "intent"), definition, plan()).value;
    run = startNextWork(run).value.run;
    run = updateTask(run, { id: "t1", evidence: "proof" }).value;
    assert.equal(run.currentTaskId, undefined);
    assert.equal(run.plan.units[0].tasks[0].evidence, "proof");

    const first = rollUpUnit(run, "s1", { summaryEntryId: "summary" });
    assert.equal(first.ok, true);
    const second = rollUpUnit(first.value, "s1", { summaryEntryId: "summary-2" });
    assert.equal(second.ok, false);
  }

  {
    const oldRun = createRun(definition, "old");
    const newRun = createRun(definition, "new");
    const ctx = {
      sessionManager: {
        getBranch: () => [
          entry("old", "created", oldRun.id, { intent: oldRun.intent }),
          entry("new", "created", newRun.id, { intent: newRun.intent }),
          entry("clear-old", "cleared", oldRun.id),
        ],
      },
    };
    assert.equal(readRun(ctx, "goal")?.intent, "new");
  }

  {
    const created = createRun(definition, "intent");
    const approved = approvePlan(created, definition, plan()).value;
    const assigned = startNextWork(approved).value.run;
    const evidenced = updateTask(assigned, { id: "t1", evidence: "proof" }).value;
    const detailed = {
      sessionManager: {
        getBranch: () => [
          entry("created", "created", created.id, { intent: created.intent }),
          entry("plan", "plan-approved", created.id, { plan: approved.plan }),
          entry("assign", "task-assigned", created.id, { unitId: "s1", taskId: "t1" }),
          entry("evidence", "task-evidence", created.id, { taskId: "t1", evidence: "proof" }),
        ],
      },
    };
    assert.equal(rollUpUnit(readRun(detailed, "goal"), "s1").ok, true);

    const summaryBranch = {
      sessionManager: {
        getBranch: () => [
          entry("created", "created", created.id, { intent: created.intent }),
          entry("plan", "plan-approved", created.id, { plan: approved.plan }),
          entry("assign", "task-assigned", created.id, { unitId: "s1", taskId: "t1" }),
          { id: "summary", type: "branch_summary" },
        ],
      },
    };
    const activeSummaryRun = readRun(summaryBranch, "goal");
    assert.equal(activeSummaryRun?.plan.units[0].tasks[0].evidence, undefined);

    const rolledUpBranch = {
      sessionManager: {
        getBranch: () => [
          entry("created", "created", created.id, { intent: created.intent }),
          entry("plan", "plan-approved", created.id, { plan: approved.plan }),
          entry("assign", "task-assigned", created.id, { unitId: "s1", taskId: "t1" }),
          { id: "summary", type: "branch_summary" },
          entry("rollup", "unit-rolled-up", created.id, {
            unitId: "s1",
            summaryEntryId: "summary",
          }),
        ],
      },
    };
    assert.match(runStatusText(readRun(rolledUpBranch, "goal"), "Goal"), /Tasks: 1\/1 complete/);
  }

  {
    const entries = [];
    let tool;
    const pi = {
      on() {},
      registerTool(config) {
        tool = config;
      },
      appendEntry(customType, data) {
        entries.push({ id: `e${entries.length}`, type: "custom", customType, data });
        return entries.at(-1).id;
      },
    };
    const ctx = {
      sessionManager: { getBranch: () => entries, getLeafId: () => entries.at(-1)?.id },
    };
    const run = createRun(definition, "intent");
    pi.appendEntry(RUNNER_ENTRY_TYPE, eventData("created", run.id, { intent: run.intent }));

    registerRunnerTool(pi, definition);
    assert.ok(tool);
    await tool.execute(
      "call",
      { action: "approve", contract: "contract", plan: plan() },
      undefined,
      undefined,
      ctx,
    );
    let active = readRun(ctx, "goal");
    active = startNextWork(active).value.run;
    pi.appendEntry(
      RUNNER_ENTRY_TYPE,
      eventData("task-assigned", active.id, { unitId: "s1", taskId: "t1" }),
    );
    await tool.execute(
      "call",
      { action: "evidence", id: "t1", result: "complete", evidence: "proof" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(readRun(ctx, "goal")?.plan.units[0].tasks[0].evidence, "proof");
  }

  {
    const entries = [];
    let tool;
    const pi = {
      registerTool(config) {
        tool = config;
      },
      appendEntry(customType, data) {
        entries.push({ id: `e${entries.length}`, type: "custom", customType, data });
        return entries.at(-1).id;
      },
    };
    const ctx = {
      sessionManager: { getBranch: () => entries, getLeafId: () => entries.at(-1)?.id },
    };
    const run = approvePlan(createRun(definition, "intent"), definition, plan()).value;
    const assigned = startNextWork(run).value.run;
    pi.appendEntry(
      RUNNER_ENTRY_TYPE,
      eventData("created", assigned.id, { intent: assigned.intent }),
    );
    pi.appendEntry(
      RUNNER_ENTRY_TYPE,
      eventData("plan-approved", assigned.id, { plan: assigned.plan }),
    );
    pi.appendEntry(
      RUNNER_ENTRY_TYPE,
      eventData("task-assigned", assigned.id, { unitId: "s1", taskId: "t1" }),
    );

    registerRunnerTool(pi, definition);
    await tool.execute(
      "call",
      { action: "evidence", id: "t1", result: "failed", evidence: "blocked by missing API" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(readRun(ctx, "goal")?.status, "paused");
    assert.equal(readRun(ctx, "goal")?.blockedReason, "task_failed");
  }

  {
    let command;
    const messages = [];
    const pi = {
      registerCommand(_name, config) {
        command = config;
      },
    };
    const customDefinition = {
      ...definition,
      command: {
        name: "demo",
        actions: [
          {
            name: "inspect",
            usage: "inspect <value>",
            handler(input, api) {
              api.ctx.ui.notify(`${api.definition.label}:${input.args}`, "info");
            },
          },
        ],
      },
    };
    registerRunnerCommand(pi, customDefinition);
    await command.handler("inspect value", {
      ui: { notify: (message) => messages.push(message) },
      sessionManager: { getSessionFile: () => "session.jsonl", getSessionId: () => "session" },
    });
    assert.deepEqual(messages, ["Goal:value"]);
  }

  {
    let command;
    const events = [];
    const entries = [];
    const pi = {
      registerCommand(_name, config) {
        command = config;
      },
      appendEntry(customType, data) {
        entries.push({ id: `e${entries.length}`, type: "custom", customType, data });
        return entries.at(-1).id;
      },
      sendMessage() {},
    };
    const ctx = {
      hasUI: false,
      ui: { notify() {} },
      sessionManager: {
        getBranch: () => entries,
        getLeafId: () => entries.at(-1)?.id,
        getSessionFile: () => "session.jsonl",
        getSessionId: () => "session",
        getLeafEntry: () => entries.at(-1),
      },
    };
    const effectDefinition = {
      ...definition,
      effects(event, api) {
        events.push(event.type);
        if (event.type === "run.created")
          api.appendFeatureEvent("created", { intent: event.intent });
      },
    };
    registerRunnerCommand(pi, effectDefinition);
    await command.handler("start effect intent", ctx);
    assert.deepEqual(events, ["run.created"]);
    assert.equal(readFeatureEvents(ctx, "goal", { type: "created" }).length, 1);
  }

  {
    let tool;
    const pi = {
      registerTool(config) {
        tool = config;
      },
    };
    const customDefinition = {
      ...definition,
      tool: {
        name: "goal",
        actions: [
          {
            action: "note",
            parameters: Type.Object({ action: Type.String(), note: Type.String() }),
            execute({ params }) {
              return { content: [{ type: "text", text: `noted:${params.note}` }], details: {} };
            },
          },
        ],
      },
    };
    registerRunnerTool(pi, customDefinition);
    const result = await tool.execute("call", { action: "note", note: "x" }, undefined, undefined, {
      sessionManager: { getBranch: () => [] },
    });
    assert.equal(result.content[0].text, "noted:x");
  }

  {
    const entries = [];
    const sent = [];
    const pi = {
      appendEntry(customType, data) {
        entries.push({ id: `e${entries.length}`, type: "custom", customType, data });
        return entries.at(-1).id;
      },
      sendMessage(message) {
        sent.push(message);
      },
    };
    const ctx = {
      hasUI: false,
      ui: { notify() {} },
      sessionManager: {
        getBranch: () => entries,
        getLeafId: () => entries.at(-1)?.id,
        getSessionFile: () => "session.jsonl",
        getSessionId: () => "session",
        getLeafEntry: () => entries.at(-1),
      },
    };
    const run = createRun(definition, "intent");
    pi.appendEntry(RUNNER_ENTRY_TYPE, eventData("created", run.id, { intent: run.intent }));

    await runRunnerController(pi, definition, ctx);
    assert.equal(sent.at(-1).customType, "runner-core-setup");

    const approved = approvePlan(run, definition, plan()).value;
    pi.appendEntry(RUNNER_ENTRY_TYPE, eventData("plan-approved", run.id, { plan: approved.plan }));
    await runRunnerController(pi, definition, ctx);
    assert.equal(sent.at(-1).customType, "runner-core-work");
    assert.equal(readRun(ctx, "goal")?.currentTaskId, "t1");

    const sentBeforeWaiting = sent.length;
    await runRunnerController(pi, definition, ctx);
    assert.equal(readRun(ctx, "goal")?.status, "active");
    assert.equal(readRun(ctx, "goal")?.currentTaskId, "t1");
    assert.equal(sent.length, sentBeforeWaiting);

    const queuedCtx = {
      sessionManager: {
        getLeafEntry: () => ({ type: "custom_message", customType: "runner-core-work" }),
      },
    };
    assert.match(turnInProgressReason(queuedCtx), /already queued/);
  }

  console.log("runner-core tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
