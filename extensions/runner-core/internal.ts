// Internal runner-core surface for built-in runner plumbing and tests.
// Feature extensions should prefer index.ts unless they intentionally need core internals.
export { registerRunnerCommand } from "./command.ts";
export { scheduleRunnerController, runRunnerController } from "./controller.ts";
export { registerRunnerTool } from "./tool.ts";
export {
  RUNNER_ENTRY_TYPE,
  appendCoreEvent,
  appendFeatureEvent,
  readFeatureEvents,
  readRun,
  type CoreEventInput,
  type FeatureEventInput,
} from "./store.ts";
export { RUNNER_SETUP_MESSAGE_TYPE, RUNNER_WORK_MESSAGE_TYPE } from "./constants.ts";

export {
  isPlanComplete,
  isTaskComplete,
  isUnitRolledUp,
  isUnitWorkComplete,
  nextReadyTask,
  validatePlan,
  type PlanValidationOptions,
} from "./graph.ts";

export {
  normalizePlan,
  normalizeTaskUpdate,
  type PlanInput,
  type TaskUpdateInput,
} from "./plan.ts";

export {
  approvePlan,
  createRun,
  currentUnit,
  finishIfComplete,
  hasAssignedIncompleteTask,
  pauseRun,
  resumeRun,
  rollUpUnit,
  startNextWork,
  unitReadyToRollUp,
  updateTask,
} from "./transitions.ts";

export type {
  CoreResult,
  ReadyWork,
  ReadFeatureEventsOptions,
  RollupPromptInput,
  RunnerCommandAction,
  RunnerCommandApi,
  RunnerCommandConfig,
  RunnerCommandInput,
  RunnerCoreEvent,
  RunnerCoreEventEntry,
  RunnerDefinition,
  RunnerEffect,
  RunnerEffectApi,
  RunnerEffectEvent,
  RunnerFeatureEventEntry,
  RunnerFeatureEventRecord,
  RunnerPolicy,
  RunnerPromptRun,
  RunnerStoredEntry,
  RunnerToolAction,
  RunnerToolActionInput,
  RunnerToolConfig,
  RunnerToolResult,
  RunPlan,
  RunState,
  RunStatus,
  RunWorkUnit,
  SetupPromptInput,
  UnitSummary,
  WorkPlan,
  WorkPromptInput,
  WorkTask,
  WorkUnit,
} from "./types.ts";
