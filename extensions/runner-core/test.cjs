const assert = require("node:assert/strict");
const jiti = require("jiti")(process.cwd() + "/extensions/runner-core/test.cjs");

const { createRun, approvePlan, startNextWork, updateTask, rollUpUnit } = jiti("./transitions.ts");
const { readRun, RUNNER_ENTRY_TYPE } = jiti("./store.ts");
const { runStatusText } = jiti("./format.ts");
const { registerRunnerTool } = jiti("./tool.ts");
const { registerRunnerCommand } = jiti("./command.ts");
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
  return {
    id,
    type: "custom",
    customType: RUNNER_ENTRY_TYPE,
    data: { version: 1, runnerId: "goal", runId, kind, timestamp: 1, ...data },
  };
}

(async () => {
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
    pi.appendEntry(RUNNER_ENTRY_TYPE, {
      version: 1,
      runnerId: "goal",
      runId: run.id,
      kind: "created",
      timestamp: 1,
      intent: run.intent,
    });

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
    pi.appendEntry(RUNNER_ENTRY_TYPE, {
      version: 1,
      runnerId: "goal",
      runId: active.id,
      kind: "task-assigned",
      timestamp: 2,
      unitId: "s1",
      taskId: "t1",
    });
    await tool.execute(
      "call",
      { action: "evidence", id: "t1", evidence: "proof" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(readRun(ctx, "goal")?.plan.units[0].tasks[0].evidence, "proof");
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
    pi.appendEntry(RUNNER_ENTRY_TYPE, {
      version: 1,
      runnerId: "goal",
      runId: run.id,
      kind: "created",
      timestamp: 1,
      intent: run.intent,
    });

    await runRunnerController(pi, definition, ctx);
    assert.equal(sent.at(-1).customType, "runner-core-setup");

    const approved = approvePlan(run, definition, plan()).value;
    pi.appendEntry(RUNNER_ENTRY_TYPE, {
      version: 1,
      runnerId: "goal",
      runId: run.id,
      kind: "plan-approved",
      timestamp: 2,
      plan: approved.plan,
    });
    await runRunnerController(pi, definition, ctx);
    assert.equal(sent.at(-1).customType, "runner-core-work");
    assert.equal(readRun(ctx, "goal")?.currentTaskId, "t1");

    await runRunnerController(pi, definition, ctx);
    assert.equal(readRun(ctx, "goal")?.status, "paused");

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
