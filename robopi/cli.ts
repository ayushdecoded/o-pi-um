import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createGitHubAdapter } from "./github/adapter.ts";
import { mediaHash } from "./github/media-uploader.ts";
import { publish, status } from "./workflow/publish.ts";
import { daemonSelfTest, startDaemon } from "./daemon/server.ts";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  if (!command || command === "help" || command === "--help") return help();

  if (command === "status") return status();
  if (command === "publish") return publish({ dryRun: argv.includes("--dry-run") });

  if (command === "media" && subcommand === "upload") return mediaUpload(rest);
  if (command === "review" && subcommand === "submit") return reviewSubmit(rest);
  if (command === "daemon") return daemon([subcommand, ...rest].filter(Boolean));

  throw new Error(`Unknown robopi command: ${argv.join(" ")}`);
}

function help(): void {
  console.log(`robopi commands

  robopi status
  robopi publish [--dry-run]
  robopi media upload <file...>
  robopi review submit --pr owner/repo#123 [--event COMMENT|REQUEST_CHANGES|APPROVE] [--dry-run]
  robopi daemon [--port 8787|--self-test]
`);
}

function mediaUpload(paths: string[]): void {
  if (paths.length === 0) throw new Error("Provide one or more media files.");
  // Real GitHub URL minting is done by publish after a PR context exists.
  console.log(
    JSON.stringify(
      paths.map((path) => ({ path, sha256: mediaHash(path) })),
      null,
      2,
    ),
  );
}

async function reviewSubmit(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const pr = valueAfter(args, "--pr");
  if (!pr) throw new Error("--pr owner/repo#123 is required.");
  const event = (valueAfter(args, "--event") ?? "COMMENT") as
    | "COMMENT"
    | "REQUEST_CHANGES"
    | "APPROVE";
  const bodyPath = join(process.cwd(), ".robopi", "review.md");
  if (!existsSync(bodyPath)) throw new Error(".robopi/review.md is required.");
  const body = readFileSync(bodyPath, "utf8");
  const parsed = parsePr(pr);
  if (dryRun) {
    console.log(JSON.stringify({ dryRun, pr: parsed, event, bodyChars: body.length }, null, 2));
    return;
  }
  const review = await createGitHubAdapter("rakun").submitReview({ ...parsed, body, event });
  console.log(`Rakun review submitted: ${review.id}`);
}

async function daemon(args: string[]): Promise<void> {
  if (args.includes("--self-test")) return daemonSelfTest();
  const port = Number(valueAfter(args, "--port") ?? 8787);
  await startDaemon({ port });
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function parsePr(value: string) {
  const match = /^(?<owner>[^/]+)\/(?<repo>[^#]+)#(?<number>\d+)$/.exec(value);
  if (!match?.groups) throw new Error(`Invalid PR ref: ${value}`);
  return {
    owner: match.groups.owner,
    repo: match.groups.repo,
    number: Number(match.groups.number),
  };
}
