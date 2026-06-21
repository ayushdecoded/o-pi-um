export type GoalStatus = "setup" | "active" | "paused" | "complete";
export type GoalBlockedReason = "waiting_on_user" | null;

export type GoalSubtask = {
  id: string;
  title: string;
  completed: boolean;
  sliceId?: number;
  createdAt: number;
  updatedAt: number;
};

export type GoalSlice = {
  id: number;
  objective: string;
  startedAt: number;
  startEntryId?: string;
};

export type GoalState = {
  id: string;
  intent: string;
  contract?: string;
  objectives: string[];
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  completedAt?: number;
  blockedReason?: GoalBlockedReason;
  blockedDetail?: string;
  subtasks: GoalSubtask[];
  sliceCounter: number;
  currentSlice?: GoalSlice;
  lastSummaryEntryId?: string;
};

export type GoalEventName =
  | "created"
  | "contract-approved"
  | "subtasks-updated"
  | "expanded"
  | "paused"
  | "resumed"
  | "completed"
  | "slice-start"
  | "slice-rolled-up"
  | "cleared";

export type GoalEntryData = {
  version: 1;
  event: GoalEventName;
  goal?: GoalState;
};

export type GoalToolParams = {
  action?: "complete" | "subtask" | "expand" | "pause";
  contract?: string;
  subtasks?: Array<{ subtask?: string; title?: string; completed?: boolean }>;
  expansions?: { add?: string[]; drop?: number };
};
