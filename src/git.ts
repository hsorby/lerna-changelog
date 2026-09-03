import { execa, execaSync } from "execa";

export function getRootPath() {
  const cwd = process.cwd();
  return execaSync("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout;
}

export async function changedPaths(sha: string): Promise<string[]> {
  const result = await execa("git", ["show", "-m", "--name-only", "--pretty=format:", "--first-parent", sha]);
  return result.stdout.split("\n");
}

/**
 * All existing tags in the repository
 */
export function listTagNames(): string[] {
  return execaSync("git", ["tag"]).stdout.split("\n").filter(Boolean);
}

/**
 * The latest reachable tag starting from HEAD
 */
export function lastTag(): string {
  return execaSync("git", ["describe", "--abbrev=0", "--tags"]).stdout;
}

/**
 * Check if the current commit is the last tag.
 * This is useful to determine if the current commit is a release commit.
 *
 * @returns true if the current commit is the last tag, false otherwise.
 */
export function atLastTag(): boolean {
  const lastTagSha = execaSync("git", ["rev-list", "-n", "1", lastTag()]).stdout;
  const headSha = execaSync("git", ["rev-parse", "HEAD"]).stdout;
  return lastTagSha === headSha;
}

/**
 * Find the preceding tag before the last one.
 * Tracing back through the commit history to find the previous tag.
 *
 * @returns String of tag that precedes the last tag.
 */
export function precedingLastTag(): string {
  const precedingTagCommit = execaSync("git", ["rev-list", "--tags", "--skip=1", "--max-count=1"]).stdout;
  const tag = execaSync("git", ["describe", "--abbrev=0", "--tags", precedingTagCommit]).stdout;
  return tag;
}

export function getTagDate(tag: string): string {
  // %as = absolute short date (YYYY-MM-DD)
  return execaSync("git", ["log", "-1", `--format=%as`, tag]).stdout.trim();
}

export interface CommitListItem {
  sha: string;
  refName: string;
  summary: string;
  date: string;
}

export function parseLogMessage(commit: string): CommitListItem | null {
  const parts = commit.match(/hash<(.+)> ref<(.*)> message<(.*)> date<(.*)>/) || [];

  if (!parts || parts.length === 0) {
    return null;
  }

  return {
    sha: parts[1],
    refName: parts[2],
    summary: parts[3],
    date: parts[4],
  };
}

export function listCommits(from: string, to: string = ""): CommitListItem[] {
  // Prints "hash<short-hash> ref<ref-name> message<summary> date<date>"
  // This format is used in `getCommitInfos` for easily analize the commit.
  return execaSync("git", [
    "log",
    "--oneline",
    "--pretty=hash<%h> ref<%D> message<%s> date<%cd>",
    "--date=short",
    `${from}..${to}`,
  ])
    .stdout.split("\n")
    .filter(Boolean)
    .map(parseLogMessage)
    .filter(Boolean) as CommitListItem[];
}
