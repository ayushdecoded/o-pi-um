import type { RunnerDefinition } from "../runner-core/index.ts";
import { robopiRollupPrompt, robopiSetupPrompt, robopiWorkPrompt } from "./prompts.ts";

// RoboPi is intentionally thin for now. Repo/GitHub behavior should stay outside
// core when it is reintroduced.
export const robopiRunner: RunnerDefinition = {
  id: "robopi",
  label: "RoboPi",
  command: {
    name: "robopi",
    description: "Run approved dependency-ordered work",
  },
  tool: {
    name: "robopi",
    description: "Approve RoboPi plans and report task results.",
  },
  setupPrompt: robopiSetupPrompt,
  workPrompt: robopiWorkPrompt,
  rollupPrompt: robopiRollupPrompt,
  policy: { maxTasksPerUnit: 8 },
};
