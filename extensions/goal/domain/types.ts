export type GoalStatus = "setup" | "active" | "paused" | "complete";
export type GoalBlockedReason = "waiting_on_user" | null;

export type GoalTask = {
  id: string;
  name: string;
  objective: string;
  verification: string;
  completed: boolean;
  evidence?: string;
  createdAt: number;
  updatedAt: number;
};

export type GoalSlice = {
  id: number;
  name: string;
  objective: string;
  startedAt: number;
  startEntryId?: string;
  tasks: GoalTask[];
};

export type GoalState = {
  id: string;
  intent: string;
  contract?: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  completedAt?: number;
  blockedReason?: GoalBlockedReason;
  blockedDetail?: string;
  sliceCounter: number;
  completedSlices: number;
  currentSlice?: GoalSlice;
  lastSummaryEntryId?: string;
};

export type GoalEventName =
  | "created"
  | "contract-approved"
  | "tasks-updated"
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

export type GoalTaskUpdate = {
  name?: string;
  objective?: string;
  verification?: string;
  completed?: boolean;
  evidence?: string;
};

export type GoalToolParams = {
  action?: "complete" | "tasks" | "pause";
  contract?: string;
  slice?: { name?: string; objective?: string };
  tasks?: GoalTaskUpdate[];
};
