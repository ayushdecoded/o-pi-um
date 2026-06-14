import type { GoalState } from "../domain/types.ts";

// Setup prompt is contract shaping only; goal work must not begin until approval.
export function setupPrompt(goal: GoalState): string {
	return `The user wants to set a long-running goal.\n\nIntent:\n<untrusted_intent>\n${escapeXml(goal.intent)}\n</untrusted_intent>\n\nClarify until success criteria, validation evidence, boundaries, and ask-before constraints are explicit. Make no assumptions; if anything material is unclear, ask. When the contract is clear, call goal with contract set to the full approved contract and no action. Do not start goal work until the contract is approved.`;
}

export function compactionRecoveryInstruction(summary: string): string {
	const excerpt = truncate(summary.replace(/\s+$/g, ""), 3200);
	return [
		"Context compaction completed. Continue with the active goal using the summary as orientation.",
		"Inspect current state before risky changes. Work on the next concrete objective/subtask only.",
		"End the turn with goal(action=\"continue\"), goal(action=\"pause\"), or goal(action=\"complete\").",
		"",
		"Compaction summary excerpt:",
		excerpt || "(empty summary)",
	].join("\n");
}

// Keep continuation small for cache reuse; only add volatile state when it changes behavior.
export function continuationPrompt(goal: GoalState, _reason?: string, extraInstruction?: string): string {
	const objective = goal.objectives?.[goal.currentObjectiveIndex ?? 0] ?? goal.intent;
	const rules = [
		"Previous goal turn is complete. Continue strictly within the approved objective.",
		"Do only the next concrete in-scope step implied by the objective/conversation.",
		"If unclear, risky, or user choice is needed, pause with the exact blocker/question.",
		"End with one: goal(action=\"continue\"), goal(action=\"pause\"), or goal(action=\"complete\"). Complete only with evidence.",
		"Use goal(action=\"subtask\", subtasks=[...]) only for durable checklist changes.",
	].join("\n");
	const extra = extraInstruction ? `\n\n${extraInstruction}` : "";
	return `${rules}\n\nApproved objective:\n<untrusted_objective>\n${escapeXml(objective)}\n</untrusted_objective>${budgetPressurePrompt(goal)}${volatileGoalStatePrompt(goal)}${extra}`;
}

// Budget text is emitted only for actual limits that are close/exhausted.
export function budgetPressurePrompt(goal: GoalState): string {
	const pressure = goalBudgetPressure(goal);
	if (!pressure) return "";
	const pct = Math.round(pressure.ratio * 100);
	if (pressure.final) return `\n\nBudget: ${pressure.kind} budget is exhausted (${pct}%). Finish the current concrete task cleanly, then pause unless the goal is fully verified.`;
	if (pressure.ratio >= 0.90) return `\n\nBudget: ${pressure.kind} budget is at ${pct}%. Converge: finish the current concrete task, avoid broad new branches, verify or pause.`;
	if (pressure.ratio >= 0.70) return `\n\nBudget: ${pressure.kind} budget is at ${pct}%. Work narrowly and avoid unnecessary exploration.`;
	return "";
}

// Avoid re-dumping full state every turn; include only budget pressure or tracked checklist.
export function volatileGoalStatePrompt(goal: GoalState): string {
	const subtasks = formatSubtasksForPrompt(goal);
	if (subtasks === "- none yet") return "";
	return "\n\nCurrent tracked subtasks:\n" + subtasks;
}

// Pick the single most urgent budget signal so prompts stay narrow.
export function goalBudgetPressure(goal: GoalState): { kind: string; ratio: number; final: boolean } | null {
	const candidates: Array<{ kind: string; ratio: number; final: boolean }> = [];
	if (goal.tokenBudget !== null) candidates.push({ kind: "token", ratio: safeRatio(goal.tokensUsed, goal.tokenBudget), final: goal.tokensUsed >= goal.tokenBudget });
	if (goal.timeBudgetSeconds != null) candidates.push({ kind: "time", ratio: safeRatio(goal.timeUsedSeconds, goal.timeBudgetSeconds), final: goal.timeUsedSeconds >= goal.timeBudgetSeconds });
	if (goal.turnBudget != null) {
		const turnsUsed = goal.turnsUsed ?? 0;
		candidates.push({ kind: "turn", ratio: safeRatio(turnsUsed + 1, goal.turnBudget), final: turnsUsed + 1 >= goal.turnBudget });
	}
	if (goal.costBudgetUsd != null) candidates.push({ kind: "cost", ratio: safeRatio(goal.costUsedUsd ?? 0, goal.costBudgetUsd), final: (goal.costUsedUsd ?? 0) >= goal.costBudgetUsd });
	const relevant = candidates.filter((item) => item.final || item.ratio >= 0.70);
	if (relevant.length === 0) return null;
	relevant.sort((a, b) => Number(b.final) - Number(a.final) || b.ratio - a.ratio);
	return relevant[0]!;
}

function safeRatio(used: number, budget: number): number {
	if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0) return 0;
	return Math.max(0, used / budget);
}


function formatSubtasksForPrompt(goal: GoalState): string {
	const subtasks = goal.subtasks ?? [];
	if (subtasks.length === 0) return "- none yet";
	return subtasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${escapeXml(item.title)}`).join("\n");
}

export function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatElapsed(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0s";
	const s = Math.round(seconds);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	if (m < 60) return rem ? `${m}m${rem}s` : `${m}m`;
	const h = Math.floor(m / 60);
	const mm = m % 60;
	return mm ? `${h}h${mm}m` : `${h}h`;
}

function formatTokens(tokens: number): string {
	if (!Number.isFinite(tokens)) return "0";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(Math.round(tokens));
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
