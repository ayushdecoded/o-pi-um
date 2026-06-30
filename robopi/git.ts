import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { RepoRef } from "./types.ts";

export function git(args: string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim());
  return result.stdout.trim();
}

export function currentBranch(cwd = process.cwd()): string {
  return git(["branch", "--show-current"], cwd);
}

export function headSha(cwd = process.cwd()): string {
  return git(["rev-parse", "HEAD"], cwd);
}

export function repoRoot(cwd = process.cwd()): string {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

export function hasStagedOrUnstagedChanges(cwd = process.cwd()): boolean {
  return git(["status", "--porcelain"], cwd).length > 0;
}

export function defaultBaseBranch(cwd = process.cwd()): string {
  try {
    return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd).replace(
      /^origin\//,
      "",
    );
  } catch {
    return "main";
  }
}

export function repoFromRemote(cwd = process.cwd(), remote = "origin"): RepoRef {
  const url = git(["remote", "get-url", remote], cwd);
  const match =
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^.]+)(?:\.git)?$/.exec(url) ??
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^.]+)(?:\.git)?$/.exec(url);
  if (!match?.groups) throw new Error(`Unsupported GitHub remote URL: ${url}`);
  return { owner: match.groups.owner, repo: match.groups.repo };
}

export function assertRoboPiBranch(branch = currentBranch()): void {
  if (!branch.startsWith("robopi/")) {
    throw new Error(`Refusing bot push from non-RoboPi branch: ${branch}`);
  }
}

export function pushWithToken(input: {
  cwd?: string;
  token: string;
  owner: string;
  repo: string;
  branch?: string;
}): void {
  const cwd = input.cwd ?? process.cwd();
  const branch = input.branch ?? currentBranch(cwd);
  assertRoboPiBranch(branch);

  // Keep tokens out of remotes and process args by using a one-shot askpass file.
  const dir = mkdtempSync(join(tmpdir(), "robopi-askpass-"));
  const askpass = join(dir, "askpass.sh");
  writeFileSync(
    askpass,
    '#!/usr/bin/env bash\ncase "$1" in *Username*) echo x-access-token ;; *Password*) echo "$ROBOPI_ASKPASS_TOKEN" ;; esac\n',
    { mode: 0o700 },
  );
  git(
    ["push", `https://github.com/${input.owner}/${input.repo}.git`, `HEAD:refs/heads/${branch}`],
    cwd,
    {
      ...process.env,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      ROBOPI_ASKPASS_TOKEN: input.token,
    },
  );
}
