import type { WorkPlan, WorkTask, WorkUnit } from "./types.ts";

export type PlanInput = {
  units?: UnitInput[];
};

export type UnitInput = {
  id?: string;
  name?: string;
  objective?: string;
  dependsOn?: string[];
  tasks?: TaskInput[];
};

export type TaskInput = {
  id?: string;
  name?: string;
  objective?: string;
  verification?: string;
  dependsOn?: string[];
};

export type TaskUpdateInput = {
  id?: string;
  evidence?: string;
};

// Convert loose tool input into strict core state. Validation happens separately
// so the user/model gets one consolidated list of plan issues.
export function normalizePlan(contract: string, input: PlanInput | undefined): WorkPlan {
  return {
    contract: contract.trim(),
    units: (input?.units ?? []).map(normalizeUnit),
  };
}

// Work updates are singular by design: one assigned task in, one evidence update out.
// Evidence implies completion.
export function normalizeTaskUpdate(
  input: TaskUpdateInput | undefined,
): Pick<WorkTask, "id" | "evidence"> | null {
  const id = input?.id?.trim();
  const evidence = input?.evidence?.trim();
  return id ? { id, ...(evidence ? { evidence } : {}) } : null;
}

function normalizeUnit(input: UnitInput): WorkUnit {
  return {
    id: input.id?.trim() ?? "",
    name: input.name?.trim() ?? "",
    objective: input.objective?.trim() ?? "",
    dependsOn: cleanDeps(input.dependsOn),
    tasks: (input.tasks ?? []).map(normalizeTask),
  };
}

function normalizeTask(input: TaskInput): WorkTask {
  return {
    id: input.id?.trim() ?? "",
    name: input.name?.trim() ?? "",
    objective: input.objective?.trim() ?? "",
    verification: input.verification?.trim() ?? "",
    dependsOn: cleanDeps(input.dependsOn),
  };
}

function cleanDeps(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((dep): dep is string => typeof dep === "string")
        .map((dep) => dep.trim())
        .filter(Boolean)
    : [];
}
