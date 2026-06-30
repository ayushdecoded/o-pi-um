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
  validators?: RunnerValidators;
  createRunMetadata?: (
    input: RunnerStartInput,
  ) => Record<string, unknown> | Promise<Record<string, unknown> | undefined> | undefined;
  workflow?: RunnerWorkflow;
  /** React to durable core events. Effects are for side effects/facts, not scheduling policy. */
  effects?: RunnerEffect | RunnerEffect[];
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
  /** Required when intentionally replacing a default action. */
  override?: boolean;
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
  appendFeatureEvent: (type: string, payload?: unknown, namespace?: string) => string;
  readFeatureEvents: (options?: ReadFeatureEventsOptions) => RunnerFeatureEventRecord[];
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
  /** Required when intentionally replacing a default action. */
  override?: boolean;
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
  appendFeatureEvent: (type: string, payload?: unknown, namespace?: string) => string;
  readFeatureEvents: (options?: ReadFeatureEventsOptions) => RunnerFeatureEventRecord[];
};

export type RunnerToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

export type RunnerStartInput = {
  intent: string;
  ctx: ExtensionCommandContext;
  definition: RunnerDefinition;
};

export type RunnerValidators = {
  plan?: RunnerPlanValidator | RunnerPlanValidator[];
};

export type RunnerPlanValidator = (input: {
  plan: WorkPlan;
  run: RunState;
  definition: RunnerDefinition;
}) => string[] | string | void;

export type RunnerWorkflow = {
  unitReadyToRollUp?: (run: RunState) => WorkUnit | null;
  isPlanComplete?: (run: RunState) => boolean;
  startNextWork?: (run: RunState) => CoreResult<{ run: RunState; work: ReadyWork }>;
};

export type RunnerEffect = (event: RunnerEffectEvent, api: RunnerEffectApi) => void | Promise<void>;

export type RunnerEffectApi = {
  runnerId: string;
  label: string;
  readRun: () => RunState | null;
  appendFeatureEvent: (type: string, payload?: unknown, namespace?: string) => string;
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
  plan?: WorkPlan;
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
  reports?: TaskReport[];
  /** Evidence is the completion marker. No separate task status exists. */
  evidence?: string;
};

export type TaskReport = {
  result: "complete" | "failed";
  evidence: string;
  createdAt: number;
};

export type UnitRollupTask = {
  id: string;
  evidence?: string;
  reports?: TaskReport[];
};

export type UnitSummary = {
  unitId: string;
  summaryEntryId?: string;
  summary?: string;
  createdAt: number;
};

export type ReadyWork = {
  unit: WorkUnit;
  task: WorkTask;
};
