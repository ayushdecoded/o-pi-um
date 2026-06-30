import type { RunnerDefinition } from "../runner-core/index.ts";
import { goalRollupPrompt, goalSetupPrompt, goalWorkPrompt } from "./prompts.ts";

// Goal is now only a runner definition: prompts + policy. All durable state,
// dependency scheduling, evidence checks, and rollups live in runner-core.
export const goalRunner: RunnerDefinition = {
  id: "goal",
  label: "Goal",
  command: {
    name: "goal",
    description: "Run an approved dependency-ordered work plan",
  },
  tool: {
    name: "goal",
    description: "Approve Goal plans and report task results.",
  },
  setupPrompt: goalSetupPrompt,
  workPrompt: goalWorkPrompt,
  rollupPrompt: goalRollupPrompt,
  policy: { maxTasksPerUnit: 10 },
};
