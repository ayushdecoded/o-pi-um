export { registerRunner } from "./registry.ts";
export { RUNNER_ENTRY_TYPE, appendRunEntry, readRun, type RunEntryInput } from "./store.ts";
export { RUNNER_SETUP_MESSAGE_TYPE, RUNNER_WORK_MESSAGE_TYPE } from "./constants.ts";

export type {
  CoreResult,
  PromptInput,
  ReadyWork,
  RunEntry,
  RunEntryKind,
  RunnerDefinition,
  RunnerPolicy,
  RunState,
  RunStatus,
  UnitSummary,
  WorkPlan,
  WorkTask,
  WorkUnit,
} from "./types.ts";

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
