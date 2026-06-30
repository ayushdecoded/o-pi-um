import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parse } from "yaml";

import type { BotName, RoboPiConfig } from "./types.ts";

const DEFAULT_CONFIG: RoboPiConfig = {
  accounts: { robopi: "robopi-bot", rakun: "rakun-bot" },
  trusted: { githubHumanAccounts: [], githubBotAccounts: [], requireTrustedPrAuthor: true },
  agents: {
    robopi: { respondOnlyWhenTagged: true },
    rakun: { autoReviewOnPrOpen: true, autoRecheckAfterRoboPiPush: false },
  },
  pr: { requireUserApprovalBeforeOpen: true, openAsDraft: true },
};

export function loadConfig(cwd = process.cwd()): RoboPiConfig {
  const file = findConfigFile(cwd);
  if (!file) return DEFAULT_CONFIG;
  const raw = parse(readFileSync(file, "utf8")) as Record<string, unknown> | null;
  return mergeConfig(raw ?? {});
}

export function findConfigFile(cwd = process.cwd()): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, ".robopi.yml");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function tokenFor(bot: BotName): string {
  const envName = bot === "robopi" ? "ROBOPI_GITHUB_TOKEN" : "RAKUN_GITHUB_TOKEN";
  const token = process.env[envName];
  if (!token) throw new Error(`${envName} is required for ${bot} GitHub operations.`);
  return token;
}

export function dataDir(cwd = process.cwd()): string {
  return resolve(process.env.ROBOPI_DATA_DIR ?? join(cwd, ".robopi-runtime"));
}

function mergeConfig(raw: Record<string, unknown>): RoboPiConfig {
  const accounts = objectAt(raw, "accounts");
  const trusted = objectAt(raw, "trusted");
  const agents = objectAt(raw, "agents");
  const robopi = objectAt(agents, "robopi");
  const rakun = objectAt(agents, "rakun");
  const pr = objectAt(raw, "pr");
  return {
    accounts: {
      robopi: stringAt(accounts, "robopi") ?? DEFAULT_CONFIG.accounts.robopi,
      rakun: stringAt(accounts, "rakun") ?? DEFAULT_CONFIG.accounts.rakun,
    },
    trusted: {
      githubHumanAccounts: stringArrayAt(trusted, "github_human_accounts"),
      githubBotAccounts: stringArrayAt(trusted, "github_bot_accounts"),
      requireTrustedPrAuthor:
        booleanAt(trusted, "require_trusted_pr_author") ??
        DEFAULT_CONFIG.trusted.requireTrustedPrAuthor,
    },
    agents: {
      robopi: {
        respondOnlyWhenTagged:
          booleanAt(robopi, "respond_only_when_tagged") ??
          DEFAULT_CONFIG.agents.robopi.respondOnlyWhenTagged,
      },
      rakun: {
        autoReviewOnPrOpen:
          booleanAt(rakun, "auto_review_on_pr_open") ??
          DEFAULT_CONFIG.agents.rakun.autoReviewOnPrOpen,
        autoRecheckAfterRoboPiPush:
          booleanAt(rakun, "auto_recheck_after_robopi_push") ??
          DEFAULT_CONFIG.agents.rakun.autoRecheckAfterRoboPiPush,
      },
    },
    pr: {
      requireUserApprovalBeforeOpen:
        booleanAt(pr, "require_user_approval_before_open") ??
        DEFAULT_CONFIG.pr.requireUserApprovalBeforeOpen,
      openAsDraft: booleanAt(pr, "open_as_draft") ?? DEFAULT_CONFIG.pr.openAsDraft,
    },
  };
}

function objectAt(value: unknown, key: string): Record<string, unknown> {
  const item = isRecord(value) ? value[key] : undefined;
  return isRecord(item) ? item : {};
}

function stringAt(value: unknown, key: string): string | undefined {
  const item = isRecord(value) ? value[key] : undefined;
  return typeof item === "string" ? item : undefined;
}

function booleanAt(value: unknown, key: string): boolean | undefined {
  const item = isRecord(value) ? value[key] : undefined;
  return typeof item === "boolean" ? item : undefined;
}

function stringArrayAt(value: unknown, key: string): string[] {
  const item = isRecord(value) ? value[key] : undefined;
  return Array.isArray(item)
    ? item.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
