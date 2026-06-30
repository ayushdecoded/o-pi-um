import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, tokenFor } from "../config.ts";
import {
  currentBranch,
  defaultBaseBranch,
  headSha,
  pushWithToken,
  repoFromRemote,
  repoRoot,
} from "../git.ts";
import { createGitHubAdapter } from "../github/adapter.ts";
import { localMediaPaths, replaceMediaLinks, uploadMediaForPr } from "../github/media-uploader.ts";
import type { PullRequestInfo } from "../types.ts";

const PR_DIR = ".robopi";
const PR_BODY = join(PR_DIR, "pr.md");
const STATE_FILE = join(PR_DIR, "state.json");

export async function publish(options: { dryRun?: boolean; cwd?: string }): Promise<void> {
  const cwd = repoRoot(options.cwd ?? process.cwd());
  const config = loadConfig(cwd);
  const branch = currentBranch(cwd);
  const repo = repoFromRemote(cwd);
  const body = readPrBody(cwd);
  const title = titleFromBody(body);
  const state = readState(cwd);

  const mediaPaths = localMediaPaths(body);
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          repo,
          branch,
          base: defaultBaseBranch(cwd),
          title,
          mediaPaths,
          existingPr: state.pr,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!branch.startsWith("robopi/"))
    throw new Error(`Publish requires a robopi/* branch, got ${branch}`);
  if (config.pr.requireUserApprovalBeforeOpen && !process.env.ROBOPI_PUBLISH_APPROVED) {
    throw new Error(
      "Publish approval required. Run through /robopi publish or set ROBOPI_PUBLISH_APPROVED=1 in automation.",
    );
  }

  const token = tokenFor("robopi");
  pushWithToken({ cwd, token, ...repo, branch });
  const github = createGitHubAdapter("robopi");
  const pr = state.pr
    ? await github.updatePrBody({ ...repo, number: state.pr.number, title, body })
    : await github.createDraftPr({
        ...repo,
        title,
        body,
        head: branch,
        base: defaultBaseBranch(cwd),
        draft: config.pr.openAsDraft,
      });

  const finalBody = await bodyWithUploadedMedia(body, pr);
  const finalPr = await github.updatePrBody({ ...repo, number: pr.number, title, body: finalBody });
  writeState(cwd, { pr: finalPr, headSha: headSha(cwd) });
  console.log(`RoboPi PR ready: ${finalPr.url}`);
}

export function status(cwd = process.cwd()): void {
  const root = repoRoot(cwd);
  const state = readState(root);
  console.log(
    JSON.stringify(
      {
        repo: repoFromRemote(root),
        branch: currentBranch(root),
        headSha: headSha(root),
        prBody: existsSync(join(root, PR_BODY)),
        pr: state.pr,
      },
      null,
      2,
    ),
  );
}

async function bodyWithUploadedMedia(body: string, pr: PullRequestInfo): Promise<string> {
  const paths = localMediaPaths(body);
  if (paths.length === 0) return body;
  const uploads = await uploadMediaForPr(paths, pr.url);
  return replaceMediaLinks(body, uploads);
}

function readPrBody(cwd: string): string {
  const path = join(cwd, PR_BODY);
  if (!existsSync(path))
    throw new Error(`${PR_BODY} is required. Write the rich PR body there first.`);
  return readFileSync(path, "utf8");
}

function titleFromBody(body: string): string {
  const heading = body.split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading?.replace(/^#\s+/, "").trim() || "RoboPi handoff";
}

function readState(cwd: string): { pr?: PullRequestInfo; headSha?: string } {
  const path = join(cwd, STATE_FILE);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as { pr?: PullRequestInfo; headSha?: string };
}

function writeState(cwd: string, state: { pr?: PullRequestInfo; headSha?: string }): void {
  mkdirSync(join(cwd, PR_DIR), { recursive: true });
  writeFileSync(join(cwd, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}
