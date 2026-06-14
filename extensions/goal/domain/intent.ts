import { MAX_OBJECTIVE_CHARS } from "./constants.ts";

export type ParsedGoalIntent = {
	intent: string;
	tokenBudget: number | null;
	timeBudgetSeconds: number | null;
	turnBudget: number | null;
	costBudgetUsd: number | null;
	error: string | null;
};

// Parse `/goal <intent> [--token-budget N] [--time-budget 30m] [--turn-budget N] [--cost-budget N]`.
// The model never handles these guardrails; this parser strips flags out of the user's raw text,
// leaving only the human intent. Budgets stay deterministic extension-owned state.
export function parseGoalIntent(raw: string): ParsedGoalIntent {
	let text = raw.trim();

	// Reads and removes integer flags such as `--token-budget 50000`.
	// Removing matched text here prevents budget flags from becoming part of the goal intent.
	const readIntFlag = (name: string): number | null => {
		const match = text.match(new RegExp(`\\s+--${name}\\s+(\\d+)\\b`));
		if (!match) return null;
		text = `${text.slice(0, match.index)} ${text.slice((match.index ?? 0) + match[0].length)}`.trim();
		return Number.parseInt(match[1] ?? "", 10);
	};

	// Same as readIntFlag, but permits decimals for dollar/cost budgets.
	const readNumberFlag = (name: string): number | null => {
		const match = text.match(new RegExp(`\\s+--${name}\\s+(\\d+(?:\\.\\d+)?)\\b`));
		if (!match) return null;
		text = `${text.slice(0, match.index)} ${text.slice((match.index ?? 0) + match[0].length)}`.trim();
		return Number.parseFloat(match[1] ?? "");
	};

	const tokenBudget = readIntFlag("token-budget");
	const timeBudgetSeconds = readDurationFlag(text);
	if (timeBudgetSeconds.matchText) text = text.replace(timeBudgetSeconds.matchText, " ").trim();
	const turnBudget = readIntFlag("turn-budget");
	const costBudgetUsd = readNumberFlag("cost-budget");

	// Allow quoting the whole intent: /goal "ship the refactor" --turn-budget 5
	const intent = text.replace(/^"(.*)"$/, "$1").trim();
	if (!intent) return { intent, tokenBudget, timeBudgetSeconds: timeBudgetSeconds.value, turnBudget, costBudgetUsd, error: "Goal intent must not be empty." };
	if (tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) return { intent, tokenBudget, timeBudgetSeconds: timeBudgetSeconds.value, turnBudget, costBudgetUsd, error: "Goal token budget must be a positive integer." };
	if (timeBudgetSeconds.value !== null && timeBudgetSeconds.value <= 0) return { intent, tokenBudget, timeBudgetSeconds: timeBudgetSeconds.value, turnBudget, costBudgetUsd, error: "Goal time budget must be positive." };
	if (turnBudget !== null && (!Number.isSafeInteger(turnBudget) || turnBudget <= 0)) return { intent, tokenBudget, timeBudgetSeconds: timeBudgetSeconds.value, turnBudget, costBudgetUsd, error: "Goal turn budget must be a positive integer." };
	if (costBudgetUsd !== null && (!Number.isFinite(costBudgetUsd) || costBudgetUsd <= 0)) return { intent, tokenBudget, timeBudgetSeconds: timeBudgetSeconds.value, turnBudget, costBudgetUsd, error: "Goal cost budget must be positive." };
	return { intent, tokenBudget, timeBudgetSeconds: timeBudgetSeconds.value, turnBudget, costBudgetUsd, error: null };
}

// Time budget supports seconds/minutes/hours: `--time-budget 30s|10m|2h`.
// We return matchText so parseGoalIntent can remove the full flag from the user intent.
function readDurationFlag(text: string): { value: number | null; matchText?: string } {
	const match = text.match(/\s+--time-budget\s+(\d+)(s|m|h)?\b/);
	if (!match) return { value: null };
	const amount = Number.parseInt(match[1] ?? "", 10);
	const unit = match[2] ?? "s";
	const multiplier = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
	return { value: amount * multiplier, matchText: match[0] };
}

export function validateObjective(objective: string): string | null {
	if (!objective) return "Goal objective must not be empty.";
	if ([...objective].length > MAX_OBJECTIVE_CHARS) return `Goal objective is too long. Limit: ${MAX_OBJECTIVE_CHARS} characters.`;
	return null;
}
