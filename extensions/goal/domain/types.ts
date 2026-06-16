// Stored lifecycle state. Setup is intentionally not a status: `objectives.length === 0` means setup.
export type GoalStatus = "active" | "paused" | "complete";

// Only deterministic blockers are stored. User ambiguity comes from the model; budgets come from extension enforcement.
export type GoalBlockedReason = "waiting_on_user" | "budget_limited" | null;
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type GoalModelOverride = {
  model: string;
  thinking?: ThinkingLevel;
};

export type GoalSubtask = {
  id: string;
  title: string;
  completed: boolean;
  // Subtasks are scoped to one objective. Expansions are just appended objectives.
  objectiveIndex: number;
  createdAt: number; // epoch seconds; internal ordering/audit only
  updatedAt: number; // epoch seconds; internal ordering/audit only
};

export type GoalMetrics = {
  toolCalls: number;
  continuationsStarted: number;
  budgetLimits: number;
};

export type GoalSubTurn = {
  // Per-continuation accounting. This replaces a separate "last turn" summary.
  index: number;
  tokens: number;
  tools: number;
  durationSeconds: number;
};

export type GoalState = {
  id: string;
  threadId: string;
  intent: string; // raw user request before clarification/approval
  objectives: string[]; // approved objective list; empty means setup/approval is still pending
  currentObjectiveIndex: number; // objective currently shown to/handled by the model
  status: GoalStatus;
  tokenBudget: number | null;
  timeBudgetSeconds?: number | null;
  turnBudget?: number | null;
  costBudgetUsd?: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  turnsUsed?: number;
  costUsedUsd?: number;
  createdAt: number; // epoch seconds; internal ordering/audit only
  updatedAt: number; // epoch seconds; internal ordering/audit only
  activatedAt?: number;
  subTurns?: GoalSubTurn[];
  completedAt?: number;
  blockedReason?: GoalBlockedReason;
  blockedDetail?: string;
  subtasks?: GoalSubtask[];
  metrics?: GoalMetrics;
  budgetLimitPrompted?: boolean;
  modelOverride?: GoalModelOverride;
};

export type GoalFile = {
  version: 1;
  goal: GoalState | null;
  modelOverride?: GoalModelOverride;
  goalEnabled?: boolean;
};

export type GoalToolParams = {
  action?: "complete" | "subtask" | "expand" | "pause" | "continue";
  contract?: string;
  subtasks?: Array<{ subtask?: string; title?: string; completed?: boolean }>;
  expansions?: { add?: string[]; drop?: number };
  subtask?: string;
  completed?: boolean;
};
