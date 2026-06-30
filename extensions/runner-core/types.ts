export type RunStatus = "setup" | "active" | "paused" | "complete";

export type CoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; issues?: string[] };

export type RunnerPolicy = {
  /** Max tasks allowed inside one unit. */
  maxTasksPerUnit?: number;
};

export type PromptInput = {
  run: RunState;
  unit?: WorkUnit;
  task?: WorkTask;
  summaries?: UnitSummary[];
};

export type RunnerDefinition = {
  id: string;
  label: string;
  command: { name: string; description?: string; subcommands?: string[] };
  tool: { name: string; description?: string };
  setup: { prompt: (input: PromptInput) => string };
  work: {
    prompt: (
      input: Required<Pick<PromptInput, "run" | "unit" | "task">> & Pick<PromptInput, "summaries">,
    ) => string;
  };
  rollup?: {
    enabled: boolean;
    prompt: (input: Required<Pick<PromptInput, "run" | "unit">>) => string;
  };
  policy?: RunnerPolicy;
};

export type RunState = {
  id: string;
  runnerId: string;
  status: RunStatus;
  intent: string;
  plan?: WorkPlan;
  currentUnitId?: string;
  currentTaskId?: string;
  blockedReason?: string;
  blockedDetail?: string;
  summaries: UnitSummary[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type WorkPlan = {
  contract: string;
  units: WorkUnit[];
};

export type WorkUnit = {
  id: string;
  name: string;
  objective: string;
  dependsOn: string[];
  tasks: WorkTask[];
  /** First task-assignment entry for this unit; used as the branch rollup anchor. */
  startEntryId?: string;
  /** Summary entry created when this unit is rolled up. Presence means unit complete. */
  summaryEntryId?: string;
};

export type WorkTask = {
  id: string;
  name: string;
  objective: string;
  verification: string;
  /** Task dependencies are local to this unit and must point to earlier tasks. */
  dependsOn: string[];
  /** Evidence is the completion marker. No separate task status exists. */
  evidence?: string;
};

export type UnitSummary = {
  unitId: string;
  summaryEntryId?: string;
  summary?: string;
  createdAt: number;
};

export type RunEntryKind =
  | "created"
  | "plan-approved"
  | "task-assigned"
  | "task-evidence"
  | "unit-rolled-up"
  | "paused"
  | "resumed"
  | "completed"
  | "cleared";

export type RunEntry = {
  version: 1;
  runnerId: string;
  runId: string;
  kind: RunEntryKind;
  timestamp: number;
  intent?: string;
  metadata?: Record<string, unknown>;
  plan?: WorkPlan;
  unitId?: string;
  taskId?: string;
  evidence?: string;
  summaryEntryId?: string;
  summary?: string;
  reason?: string;
  detail?: string;
};

export type ReadyWork = {
  unit: WorkUnit;
  task: WorkTask;
};
