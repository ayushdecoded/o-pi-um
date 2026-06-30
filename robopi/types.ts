export type BotName = "robopi" | "rakun";

export type RepoRef = {
  owner: string;
  repo: string;
};

export type RoboPiConfig = {
  accounts: { robopi: string; rakun: string };
  trusted: {
    githubHumanAccounts: string[];
    githubBotAccounts: string[];
    requireTrustedPrAuthor: boolean;
  };
  agents: {
    robopi: { respondOnlyWhenTagged: boolean };
    rakun: { autoReviewOnPrOpen: boolean; autoRecheckAfterRoboPiPush: boolean };
  };
  pr: { requireUserApprovalBeforeOpen: boolean; openAsDraft: boolean };
};

export type PullRequestRef = RepoRef & {
  number: number;
};

export type PullRequestInfo = PullRequestRef & {
  url: string;
  headRef: string;
  headSha: string;
  draft: boolean;
};

export type NormalizedGitHubEvent = {
  deliveryId: string;
  event: string;
  action?: string;
  repo: RepoRef;
  pr?: { number: number; headSha?: string; headRef?: string };
  actor: { login: string; trusted: boolean };
  mention?: BotName;
  scope: "pr" | "comment" | "review" | "review_comment" | "push";
  githubIds: Record<string, string | number>;
  receivedAt: string;
  rawPath: string;
};
