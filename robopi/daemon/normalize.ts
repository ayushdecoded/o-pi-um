import type { RoboPiConfig } from "../types.ts";
import type { NormalizedGitHubEvent } from "../types.ts";

export function normalizeGitHubEvent(input: {
  event: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  rawPath: string;
  config: RoboPiConfig;
}): NormalizedGitHubEvent {
  const repo = objectAt(input.payload, "repository");
  const pr = objectAt(input.payload, "pull_request");
  const issue = objectAt(input.payload, "issue");
  const sender = objectAt(input.payload, "sender");
  const actor = stringAt(sender, "login") ?? "unknown";
  const body = eventBody(input.payload);
  return {
    deliveryId: input.deliveryId,
    event: input.event,
    ...(stringAt(input.payload, "action") ? { action: stringAt(input.payload, "action") } : {}),
    repo: {
      owner: stringAt(objectAt(repo, "owner"), "login") ?? "unknown",
      repo: stringAt(repo, "name") ?? "unknown",
    },
    ...(prOrIssueNumber(pr, issue) ? { pr: prOrIssueNumber(pr, issue) } : {}),
    actor: { login: actor, trusted: trustedActor(input.config, actor) },
    ...(mentionFor(body, input.config) ? { mention: mentionFor(body, input.config) } : {}),
    scope: scopeFor(input.event),
    githubIds: idsFor(input.payload),
    receivedAt: new Date().toISOString(),
    rawPath: input.rawPath,
  };
}

function trustedActor(config: RoboPiConfig, login: string): boolean {
  return new Set([
    config.accounts.robopi,
    config.accounts.rakun,
    ...config.trusted.githubHumanAccounts,
    ...config.trusted.githubBotAccounts,
  ]).has(login);
}

function mentionFor(body: string, config: RoboPiConfig): "robopi" | "rakun" | undefined {
  if (body.includes(`@${config.accounts.robopi}`)) return "robopi";
  if (body.includes(`@${config.accounts.rakun}`)) return "rakun";
  return undefined;
}

function scopeFor(event: string): NormalizedGitHubEvent["scope"] {
  if (event === "issue_comment") return "comment";
  if (event === "pull_request_review") return "review";
  if (event === "pull_request_review_comment") return "review_comment";
  if (event === "push") return "push";
  return "pr";
}

function prOrIssueNumber(pr: Record<string, unknown>, issue: Record<string, unknown>) {
  const number = numberAt(pr, "number") ?? numberAt(issue, "number");
  if (!number) return undefined;
  return {
    number,
    headSha: stringAt(objectAt(pr, "head"), "sha"),
    headRef: stringAt(objectAt(pr, "head"), "ref"),
  };
}

function idsFor(payload: Record<string, unknown>): Record<string, string | number> {
  return {
    ...(numberAt(objectAt(payload, "comment"), "id")
      ? { comment: numberAt(objectAt(payload, "comment"), "id")! }
      : {}),
    ...(numberAt(objectAt(payload, "review"), "id")
      ? { review: numberAt(objectAt(payload, "review"), "id")! }
      : {}),
  };
}

function eventBody(payload: Record<string, unknown>): string {
  return ["comment", "review", "pull_request", "issue"]
    .map((key) => stringAt(objectAt(payload, key), "body"))
    .filter(Boolean)
    .join("\n");
}

function objectAt(value: unknown, key: string): Record<string, unknown> {
  const item = isRecord(value) ? value[key] : undefined;
  return isRecord(item) ? item : {};
}

function stringAt(value: unknown, key: string): string | undefined {
  const item = isRecord(value) ? value[key] : undefined;
  return typeof item === "string" ? item : undefined;
}

function numberAt(value: unknown, key: string): number | undefined {
  const item = isRecord(value) ? value[key] : undefined;
  return typeof item === "number" ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
