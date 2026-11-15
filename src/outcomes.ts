// PR and issue outcomes become decisions, so a closed PR counts the same as a "no" in conversation.
import { readDecisions, recordDecisions, type Decision } from "./store.ts";
import { git, gitQuery, onPath, run } from "./run.ts";

// The latest 100 of each is enough: outcomes are folded into the store on every run.
const QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(labels: ["workwork"], first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number state closedAt headRefOid mergeCommit { oid } commits(first: 100) { nodes { commit { message } } } comments(last: 1) { nodes { body } } }
    }
    issues(labels: ["workwork"], first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number state stateReason closedAt body comments(last: 1) { nodes { body } } }
    }
  }
}`;

type Comments = { nodes: { body: string }[] };
type PullRequest = {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  closedAt: string | null;
  headRefOid: string;
  mergeCommit: { oid: string } | null;
  commits: { nodes: { commit: { message: string } }[] };
  comments: Comments;
};
type Issue = {
  number: number;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  closedAt: string | null;
  body: string;
  comments: Comments;
};

export type History = { decisions: Decision[]; inProgress: Set<string> };

/** All decisions, after folding in new GitHub outcomes. Ids with an open PR or issue are in progress. */
export async function syncHistory(repo: string): Promise<History> {
  const github = await githubOutcomes(repo);
  const stored = readDecisions(repo);
  const known = new Set(stored.map(outcomeKey));
  const fresh = github.decisions.filter((decision) => !known.has(outcomeKey(decision)));
  if (fresh.length) recordDecisions(repo, fresh);
  return {
    decisions: [...stored, ...fresh].sort((a, b) => a.date.localeCompare(b.date)),
    inProgress: github.inProgress,
  };
}

function outcomeKey({ id, source, ref }: Decision): string {
  return `${id} ${source} ${ref}`;
}

async function githubOutcomes(repo: string): Promise<History> {
  const decisions: Decision[] = [];
  const inProgress = new Set<string>();
  if (!gitQuery(repo, ["remote", "get-url", "origin"])?.includes("github.com") || !onPath("gh")) {
    return { decisions, inProgress };
  }
  const args = [
    "api",
    "graphql",
    "-F",
    "owner={owner}",
    "-F",
    "repo={repo}",
    "-f",
    `query=${QUERY}`,
  ];
  const { code, stdout, stderr } = await run("gh", args, repo);
  // gh may be logged out, as on a fresh server: the stored decisions still count.
  if (code !== 0) {
    console.error(`workwork: GitHub outcomes not read (${stderr.trim().split("\n")[0]})`);
    return { decisions, inProgress };
  }
  const { pullRequests, issues } = JSON.parse(stdout).data.repository as {
    pullRequests: { nodes: PullRequest[] };
    issues: { nodes: Issue[] };
  };
  const head = git(repo, ["rev-parse", "HEAD"]);

  for (const pr of pullRequests.nodes) {
    const ids = new Set(pr.commits.nodes.flatMap(({ commit }) => trailerIds(commit.message)));
    if (pr.state === "OPEN") ids.forEach((id) => inProgress.add(id));
    else {
      const merged = pr.state === "MERGED";
      const reason = merged ? "merged" : (pr.comments.nodes[0]?.body ?? "closed without a comment");
      const commit = pr.mergeCommit?.oid ?? pr.headRefOid;
      const decision = merged ? "accept" : "reject";
      for (const id of ids)
        decisions.push(
          outcome(id, {
            decision,
            reason,
            source: "pr",
            ref: `#${pr.number}`,
            commit,
            date: pr.closedAt,
          }),
        );
    }
  }
  for (const issue of issues.nodes) {
    const ids = trailerIds(issue.body);
    if (issue.state === "OPEN") ids.forEach((id) => inProgress.add(id));
    else {
      const reason =
        issue.comments.nodes[0]?.body ??
        `closed as ${issue.stateReason?.toLowerCase().replace("_", " ")}`;
      const decision = issue.stateReason === "COMPLETED" ? "accept" : "reject";
      for (const id of ids)
        decisions.push(
          outcome(id, {
            decision,
            reason,
            source: "issue",
            ref: `#${issue.number}`,
            commit: head,
            date: issue.closedAt,
          }),
        );
    }
  }
  return { decisions, inProgress };
}

type Outcome = Pick<Decision, "decision" | "reason" | "source" | "ref" | "commit"> & {
  date: string | null;
};

function outcome(id: string, { reason, date, ...rest }: Outcome): Decision {
  const slash = id.indexOf("/");
  return {
    id,
    play: id.slice(0, slash),
    path: id.slice(slash + 1),
    ...rest,
    reason: reason.trim(),
    date: date ?? new Date().toISOString(),
  };
}

function trailerIds(text: string): string[] {
  return [...text.matchAll(/^Workwork: (\S+)\s*$/gm)].map((match) => match[1]);
}
