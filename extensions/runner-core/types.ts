import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type RunStatus = "setup" | "active" | "paused" | "complete";

export type CoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; issues?: string[] };

export type RunnerPolicy = {
  /** Max tasks allowed inside one unit. */
  maxTasksPerUnit?: number;
};

export type SetupPromptInput = { run: RunState };
export type WorkPromptInput = {
  run: RunState;
  unit: WorkUnit;
  task: WorkTask;
  summaries?: UnitSummary[];
};
export type RollupPromptInput = { run: RunState; unit: WorkUnit };

export type RunnerDefinition = {
  id: string;
  label: string;
  command: RunnerCommandConfig;
  tool: RunnerToolConfig;
  setupPrompt: (input: SetupPromptInput) => string;
  workPrompt: (input: WorkPromptInput) => string;
  /** Omit for the core rollup prompt; set rollup:false to skip branch summaries. */
  rollupPrompt?: (input: RollupPromptInput) => string;
  rollup?: false;
  policy?: RunnerPolicy;
  workflow?: RunnerWorkflow;
  hooks?: RunnerHooks;
};

export type RunnerCommandConfig = {
  name: string;
  description?: string;
  /** Defaults to true. Set false when a feature wants to own every command action. */
  includeDefaultActions?: boolean;
  /** Feature-specific actions or overrides for start/status/pause/resume/clear/help. */
  actions?: RunnerCommandAction[];
};

export type RunnerCommandAction = {
  name: string;
  aliases?: string[];
  description?: string;
  usage?: string;
  complete?: (input: RunnerCommandInput) => AutocompleteItem[] | null;
  handler: (input: RunnerCommandInput, api: RunnerCommandApi) => void | Promise<void>;
};

export type RunnerCommandInput = {
  raw: string;
  args: string;
  action: string;
};

export type RunnerCommandApi = {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  definition: RunnerDefinition;
  readRun: () => RunState | null;
  appendEntry: (entry: RunnerEntryDraft) => string;
  runController: () => Promise<void>;
};

export type RunnerToolConfig = {
  name: string;
  description?: string;
  /** Defaults to true. Set false when a feature wants a fully custom model tool. */
  includeDefaultActions?: boolean;
  /** Feature-specific model-facing actions. Each schema must include an action discriminator. */
  actions?: RunnerToolAction[];
};

export type RunnerToolAction = {
  action: string;
  parameters: unknown;
  guideline?: string;
  execute: (input: RunnerToolActionInput) => RunnerToolResult | Promise<RunnerToolResult>;
};

export type RunnerToolActionInput = {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  definition: RunnerDefinition;
  params: Record<string, unknown>;
  run: RunState | null;
};

export type RunnerToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

export type RunnerWorkflow = {
  hasAssignedIncompleteTask?: (run: RunState) => boolean;
  unitReadyToRollUp?: (run: RunState) => WorkUnit | null;
  isPlanComplete?: (run: RunState) => boolean;
  startNextWork?: (run: RunState) => CoreResult<{ run: RunState; work: ReadyWork }>;
  onNoProgress?: (input: RunnerHookInput) => "pause" | "ignore" | Promise<"pause" | "ignore">;
};

export type RunnerHooks = {
  onRunCreated?: (input: RunnerHookInput) => void | Promise<void>;
  onPlanApproved?: (input: RunnerHookInput) => void | Promise<void>;
  onTaskAssigned?: (input: RunnerHookInput & { work: ReadyWork }) => void | Promise<void>;
  onTaskEvidence?: (
    input: RunnerHookInput & { taskId: string; evidence: string },
  ) => void | Promise<void>;
  onUnitRolledUp?: (input: RunnerHookInput & { unitId: string }) => void | Promise<void>;
  onPaused?: (input: RunnerHookInput) => void | Promise<void>;
  onResumed?: (input: RunnerHookInput) => void | Promise<void>;
  onCompleted?: (input: RunnerHookInput) => void | Promise<void>;
};

export type RunnerHookInput = {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  definition: RunnerDefinition;
  run: RunState;
  readRun: () => RunState | null;
};

export type RunnerEntryDraft = Omit<RunEntry, "version" | "timestamp" | "runnerId"> & {
  runnerId?: string;
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
