import { Octokit } from "@octokit/rest";

import { tokenFor } from "../config.ts";
import type { BotName, PullRequestInfo, PullRequestRef, RepoRef } from "../types.ts";

export type GitHubAdapter = ReturnType<typeof createGitHubAdapter>;

export function createGitHubAdapter(bot: BotName) {
  const octokit = new Octokit({ auth: tokenFor(bot), userAgent: `robopi-${bot}` });

  return {
    async createDraftPr(
      input: RepoRef & { title: string; body: string; head: string; base: string; draft: boolean },
    ) {
      const response = await octokit.pulls.create({
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      });
      return pullInfo(response.data);
    },

    async updatePrBody(input: PullRequestRef & { body: string; title?: string }) {
      const response = await octokit.pulls.update({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.number,
        body: input.body,
        ...(input.title ? { title: input.title } : {}),
      });
      return pullInfo(response.data);
    },

    async listPrActivity(input: PullRequestRef) {
      const [issueComments, reviewComments, reviews] = await Promise.all([
        octokit.issues.listComments({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.number,
        }),
        octokit.pulls.listReviewComments({
          owner: input.owner,
          repo: input.repo,
          pull_number: input.number,
        }),
        octokit.pulls.listReviews({
          owner: input.owner,
          repo: input.repo,
          pull_number: input.number,
        }),
      ]);
      return {
        issueComments: issueComments.data.map(commentInfo),
        reviewComments: reviewComments.data.map(commentInfo),
        reviews: reviews.data.map((review) => ({
          id: review.id,
          user: review.user?.login ?? "unknown",
          body: review.body ?? "",
          state: review.state,
          submittedAt: review.submitted_at ?? undefined,
        })),
      };
    },

    async postIssueComment(input: PullRequestRef & { body: string }) {
      const response = await octokit.issues.createComment({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        body: input.body,
      });
      return commentInfo(response.data);
    },

    async replyToReviewComment(input: PullRequestRef & { commentId: number; body: string }) {
      const response = await octokit.pulls.createReplyForReviewComment({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.number,
        comment_id: input.commentId,
        body: input.body,
      });
      return commentInfo(response.data);
    },

    async submitReview(
      input: PullRequestRef & { body: string; event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE" },
    ) {
      const response = await octokit.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.number,
        body: input.body,
        event: input.event,
      });
      return { id: response.data.id, state: response.data.state, body: response.data.body ?? "" };
    },
  };
}

function pullInfo(data: {
  number: number;
  html_url: string;
  head: { ref: string; sha: string };
  draft?: boolean | null;
  base: { repo: { owner: { login: string }; name: string } };
}): PullRequestInfo {
  return {
    owner: data.base.repo.owner.login,
    repo: data.base.repo.name,
    number: data.number,
    url: data.html_url,
    headRef: data.head.ref,
    headSha: data.head.sha,
    draft: data.draft === true,
  };
}

function commentInfo(data: {
  id: number;
  html_url: string;
  body?: string | null;
  user?: { login?: string } | null;
}) {
  return {
    id: data.id,
    url: data.html_url,
    body: data.body ?? "",
    user: data.user?.login ?? "unknown",
  };
}
