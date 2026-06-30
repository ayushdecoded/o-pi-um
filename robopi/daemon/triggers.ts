import type { NormalizedGitHubEvent, RoboPiConfig } from "../types.ts";

export type QueuedJob = {
  kind: "robopi_respond" | "rakun_review";
  deliveryId: string;
  reason: string;
};

export function jobsForEvent(event: NormalizedGitHubEvent, config: RoboPiConfig): QueuedJob[] {
  if (!event.actor.trusted) return [];
  const jobs: QueuedJob[] = [];

  if (event.mention === "robopi") {
    jobs.push({
      kind: "robopi_respond",
      deliveryId: event.deliveryId,
      reason: "trusted robopi mention",
    });
  }
  if (event.mention === "rakun") {
    jobs.push({
      kind: "rakun_review",
      deliveryId: event.deliveryId,
      reason: "trusted rakun mention",
    });
  }
  if (
    event.event === "pull_request" &&
    event.action === "opened" &&
    config.agents.rakun.autoReviewOnPrOpen
  ) {
    jobs.push({
      kind: "rakun_review",
      deliveryId: event.deliveryId,
      reason: "auto review on PR open",
    });
  }
  if (event.event === "push" && config.agents.rakun.autoRecheckAfterRoboPiPush) {
    jobs.push({
      kind: "rakun_review",
      deliveryId: event.deliveryId,
      reason: "auto recheck after push",
    });
  }

  return jobs;
}
