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

export type RunnerRunView = Omit<
  RunState,
  "plan" | "metadata" | "currentTaskPacketId" | "currentTaskId" | "currentUnitId"
> & { plan?: WorkPlan };

export type RunnerPromptRun = RunnerRunView;

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
  /** Required to replace a built-in command action with the same name. */
  overrideDefault?: boolean;
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
  readRun: () => RunnerRunView | null;
  appendFeatureEvent: AppendFeatureEvent<TEvents>;
  readFeatureEvents: <
    TType extends RunnerFeatureEventName<TEvents> = RunnerFeatureEventName<TEvents>,
  >(
    options?: ReadFeatureEventsOptions & { type?: TType },
  ) => RunnerFeatureEventRecord<TEvents, TType>[];
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
  /** Required to replace a built-in tool action with the same action name. */
  overrideDefault?: boolean;
  /** Defaults to true: action must come from the active runner packet. */
  requireRunId?: boolean;
  execute: (input: RunnerToolActionInput<TEvents>) => RunnerToolResult | Promise<RunnerToolResult>;
};

export type RunnerToolActionInput<TEvents extends object = RunnerFeatureEventMap> = {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  definition: RunnerDefinition<TEvents>;
  params: Record<string, unknown>;
  run: RunnerRunView | null;
  appendFeatureEvent: AppendFeatureEvent<TEvents>;
  readFeatureEvents: <
    TType extends RunnerFeatureEventName<TEvents> = RunnerFeatureEventName<TEvents>,
  >(
    options?: ReadFeatureEventsOptions & { type?: TType },
  ) => RunnerFeatureEventRecord<TEvents, TType>[];
};

export type RunnerToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
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
  readRun: () => RunnerRunView | null;
  appendFeatureEvent: AppendFeatureEvent<TEvents>;
  readFeatureEvents: <
    TType extends RunnerFeatureEventName<TEvents> = RunnerFeatureEventName<TEvents>,
  >(
    options?: ReadFeatureEventsOptions & { type?: TType },
  ) => RunnerFeatureEventRecord<TEvents, TType>[];
  notify: ExtensionContext["ui"]["notify"];
};

export type RunnerEffectEvent = RunnerCoreEvent & {
  run: RunnerRunView;
  entryId: string;
};

export type RunnerCoreEvent =
  | { type: "run.created"; intent: string; metadata?: Record<string, unknown> }
  | { type: "plan.approved"; plan: WorkPlan }
  | { type: "task.assigned"; unitId: string; taskId: string; packetId: string }
  | {
      type: "task.reported";
      taskId: string;
      result: "complete" | "failed";
      evidence: string;
      attemptId: string;
    }
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

export type RunnerFeatureEventRecord<
  TEvents extends object = RunnerFeatureEventMap,
  TType extends RunnerFeatureEventName<TEvents> = RunnerFeatureEventName<TEvents>,
> = {
  id: string;
  runnerId: string;
  runId: string;
  namespace: string;
  type: TType;
  payload?: TEvents[TType];
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
  currentTaskPacketId?: string;
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
  metadata?: Record<string, unknown>;
};

export type RunPlan = Omit<WorkPlan, "units"> & { units: RunWorkUnit[] };

export type WorkUnit = {
  id: string;
  name: string;
  objective: string;
  dependsOn: string[];
  tasks: WorkTask[];
  metadata?: Record<string, unknown>;
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
  metadata?: Record<string, unknown>;
  reports?: TaskReport[];
};

export type TaskReport = {
  attemptId: string;
  result: "complete" | "failed";
  evidence: string;
  createdAt: number;
};

export type UnitRollupTask = Pick<WorkTask, "id" | "evidence" | "reports">;

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
