export type ThinkingLevelType = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ModelRoute = {
  model: string;
  reasoning?: ThinkingLevelType;
  secondaryModel?: string;
  secondaryReasoning?: ThinkingLevelType;
};

export type SubagentTimeout = number;

export type SubagentOptionsType = {
  model?: string;
  reasoning?: ThinkingLevelType;
  timeout?: SubagentTimeout;
};

export type SubagentParamsType = {
  task?: string;
  tasks?: Array<{
    task: string;
    model?: string;
    reasoning?: ThinkingLevelType;
    timeout?: SubagentTimeout;
  }>;
  sessionFile?: string;
  options?: SubagentOptionsType;
};

export type FollowupParamsType = {
  sessionFile: string;
  message: string;
  model?: string;
  reasoning?: ThinkingLevelType;
  timeout?: SubagentTimeout;
};

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokens: number;
  costUsd: number;
}

export interface RunDetails {
  id: string;
  task: string;
  model?: string;
  status: "running" | "complete" | "failed";
  exitCode?: number;
  output?: string;
  error?: string;
  sessionFile?: string;
  startedAt: number;
  completedAt?: number;
  usage?: RunUsage;
}

export interface ToolDetails {
  runs: RunDetails[];
}

export interface ActiveRun {
  id: string;
  task: string;
  model?: string;
  startedAt: number;
  status: "queued" | "running";
}
