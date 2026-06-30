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

export type RunnerPromptRun = Omit<
  RunState,
  "plan" | "metadata" | "currentTaskPacketEntryId" | "currentTaskId" | "currentUnitId"
> & { plan?: WorkPlan };

export type SetupPromptInput = { run: RunnerPromptRun };
export type WorkPromptInput = {
  run: RunnerPromptRun;
  unit: WorkUnit;
  task: WorkTask;
  summaries?: UnitSummary[];
};
export type RollupPromptInput = { run: RunnerPromptRun; unit: WorkUnit };

export type RunnerFeatureEventMap = Record<string, unknown>;
export type RunnerFeatureEventName<TEvents extends object> = Extract<keyof TEvents, string>;

export type RunnerDefinition<TEvents extends object = RunnerFeatureEventMap> = {
  id: string;
  label: string;
  command: RunnerCommandConfig<TEvents>;
  tool: RunnerToolConfig<TEvents>;
  setupPrompt: (input: SetupPromptInput) => string;
  workPrompt: (input: WorkPromptInput) => string;
  /** Omit for the core rollup prompt; set rollup:false to skip branch summaries. */
  rollupPrompt?: (input: RollupPromptInput) => string;
  rollup?: false;
  policy?: RunnerPolicy;
  workflow?: RunnerWorkflow;
  /** React to durable core events. Effects are for side effects/facts, not scheduling policy. */
  effects?: RunnerEffect<TEvents> | RunnerEffect<TEvents>[];
};

export type RunnerCommandConfig<TEvents extends object = RunnerFeatureEventMap> = {
  name: string;
  description?: string;
  /** Defaults to true. Set false when a feature wants to own every command action. */
  includeDefaultActions?: boolean;
  /** Feature-specific actions or overrides for start/status/pause/resume/clear/help. */
  actions?: RunnerCommandAction<TEvents>[];
};

export type RunnerCommandAction<TEvents extends object = RunnerFeatureEventMap> = {
  name: string;
  aliases?: string[];
  description?: string;
  usage?: string;
  complete?: (input: RunnerCommandInput) => AutocompleteItem[] | null;
  handler: (input: RunnerCommandInput, api: RunnerCommandApi<TEvents>) => void | Promise<void>;
};

export type RunnerCommandInput = {
  raw: string;
  args: string;
  action: string;
};

export type RunnerCommandApi<TEvents extends object = RunnerFeatureEventMap> = {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  definition: RunnerDefinition<TEvents>;
  readRun: () => RunState | null;
  appendFeatureEvent: AppendFeatureEvent<TEvents>;
  readFeatureEvents: (options?: ReadFeatureEventsOptions) => RunnerFeatureEventRecord[];
  runController: () => Promise<void>;
};

export type RunnerToolConfig<TEvents extends object = RunnerFeatureEventMap> = {
  name: string;
  description?: string;
  /** Optional model-facing summary. Defaults to the configured action names. */
  promptSnippet?: string;
  /** Defaults to true. Set false when a feature wants a fully custom model tool. */
  includeDefaultActions?: boolean;
  /** Feature-specific model-facing actions. Each schema must include an action discriminator. */
  actions?: RunnerToolAction<TEvents>[];
};

export type RunnerToolAction<TEvents extends object = RunnerFeatureEventMap> = {
  action: string;
  parameters: unknown;
  guideline?: string;
  /** Defaults to true: action must include runId and match the active run. */
  requireRunId?: boolean;
  execute: (input: RunnerToolActionInput<TEvents>) => RunnerToolResult | Promise<RunnerToolResult>;
};

export type RunnerToolActionInput<TEvents extends object = RunnerFeatureEventMap> = {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  definition: RunnerDefinition<TEvents>;
  params: Record<string, unknown>;
  run: RunState | null;
  appendFeatureEvent: AppendFeatureEvent<TEvents>;
  readFeatureEvents: (options?: ReadFeatureEventsOptions) => RunnerFeatureEventRecord[];
};

export type RunnerToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

export type RunnerWorkflow = {
  unitReadyToRollUp?: (run: RunState) => RunWorkUnit | null;
  isPlanComplete?: (run: RunState) => boolean;
  startNextWork?: (run: RunState) => CoreResult<{ run: RunState; work: ReadyWork }>;
};

export type AppendFeatureEvent<TEvents extends object = RunnerFeatureEventMap> = <
  TType extends RunnerFeatureEventName<TEvents>,
>(
  type: TType,
  ...args: undefined extends TEvents[TType]
    ? [payload?: TEvents[TType], namespace?: string]
    : [payload: TEvents[TType], namespace?: string]
) => string;

export type RunnerEffect<TEvents extends object = RunnerFeatureEventMap> = (
  event: RunnerEffectEvent,
  api: RunnerEffectApi<TEvents>,
) => void | Promise<void>;

export type RunnerEffectApi<TEvents extends object = RunnerFeatureEventMap> = {
  runnerId: string;
  label: string;
  readRun: () => RunState | null;
  appendFeatureEvent: AppendFeatureEvent<TEvents>;
  readFeatureEvents: (options?: ReadFeatureEventsOptions) => RunnerFeatureEventRecord[];
  notify: ExtensionContext["ui"]["notify"];
};

export type RunnerEffectEvent = RunnerCoreEvent & {
  run: RunState;
  entryId: string;
};

export type RunnerCoreEvent =
  | { type: "run.created"; intent: string; metadata?: Record<string, unknown> }
  | { type: "plan.approved"; plan: WorkPlan }
  | { type: "task.assigned"; unitId: string; taskId: string }
  | { type: "task.packet_sent"; unitId: string; taskId: string }
  | { type: "task.reported"; taskId: string; result: "complete" | "failed"; evidence: string }
  | {
      type: "unit.rolled_up";
      unitId: string;
      tasks?: UnitRollupTask[];
      summaryEntryId?: string;
      summary?: string;
    }
  | { type: "run.paused"; reason: string; detail?: string }
  | { type: "run.resumed" }
  | { type: "run.completed" }
  | { type: "run.cleared" };

export type RunnerFeatureEventRecord = {
  id: string;
  runnerId: string;
  runId: string;
  namespace: string;
  type: string;
  payload?: unknown;
  timestamp: number;
};

export type ReadFeatureEventsOptions = {
  runId?: string;
  namespace?: string;
  type?: string;
};

export type RunnerStoredEntry = RunnerCoreEventEntry | RunnerFeatureEventEntry;

export type RunnerCoreEventEntry = {
  version: 1;
  scope: "core";
  runnerId: string;
  runId: string;
  timestamp: number;
  event: RunnerCoreEvent;
};

export type RunnerFeatureEventEntry = {
  version: 1;
  scope: "feature";
  runnerId: string;
  runId: string;
  timestamp: number;
  namespace: string;
  event: string;
  payload?: unknown;
};

export type RunState = {
  id: string;
  runnerId: string;
  status: RunStatus;
  intent: string;
  plan?: RunPlan;
  currentUnitId?: string;
  currentTaskId?: string;
  currentTaskPacketEntryId?: string;
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

export type RunPlan = Omit<WorkPlan, "units"> & { units: RunWorkUnit[] };

export type WorkUnit = {
  id: string;
  name: string;
  objective: string;
  dependsOn: string[];
  tasks: WorkTask[];
};

export type RunnerUnitState = {
  /** First task-assignment entry for this unit; used as the branch rollup anchor. */
  startEntryId?: string;
  /** Summary entry created when this unit is rolled up. Presence means unit complete. */
  summaryEntryId?: string;
};

export type RunWorkUnit = WorkUnit & {
  /** Core-owned bookkeeping. Prompt authors should read domain fields, not this metadata. */
  runner?: RunnerUnitState;
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

export type UnitRollupTask = Pick<WorkTask, "id" | "evidence">;

export type UnitSummary = {
  unitId: string;
  summaryEntryId?: string;
  summary?: string;
  createdAt: number;
};

export type ReadyWork = {
  unit: RunWorkUnit;
  task: WorkTask;
};
