import pMap from "p-map";

import progressBar from "./progress-bar.js";
import { Configuration } from "./configuration.js";
import findPullRequestId from "./find-pull-request-id.js";
import * as Git from "./git.js";
import GithubAPI, { GitHubAuthorResponse, GitHubUserResponse } from "./github-api.js";
import { CommitInfo, Release } from "./interfaces.js";
import MarkdownRenderer from "./markdown-renderer.js";

const UNRELEASED_TAG = "___unreleased___";

interface Options {
  tagFrom?: string;
  tagTo?: string;
  quiet?: boolean;
}

export default class Changelog {
  private readonly config: Configuration;
  private github: GithubAPI;
  private renderer: MarkdownRenderer;
  private prCache = new Map<number, Promise<{ pr: any; linkedIssues: any[] }>>();
  constructor(config: Configuration) {
    this.config = config;
    this.github = new GithubAPI(this.config);
    this.renderer = new MarkdownRenderer({
      categories: Object.keys(this.config.labels).map(key => this.config.labels[key]),
      baseIssueUrl: this.github.getBaseIssueUrl(this.config.repo),
      unreleasedName: this.config.nextVersion || "Unofficial Release",
    });
  }

  public async createMarkdown(options: Options = {}) {
    const from = options.tagFrom || (await Git.lastTag());
    const to = options.tagTo || "HEAD";

    const releases = await this.listReleases(from, to, options.quiet);

    return this.renderer.renderMarkdown(releases);
  }

  private async getPullRequestsInfo(from: string, to: string, quiet?: boolean): Promise<any[]> {
    // Currently not used, but kept for future use.
    if (!quiet) {
      console.log(`Getting commits from ${from} to ${to}...`);
    }
    const commits = this.getListOfCommits(from, to);
    const commitInfos = this.toCommitInfos(commits);
    await this.downloadIssueData(commitInfos);
    const pullRequestInfo = this.extractPullRequestInfo(commitInfos);

    this.assignToCategories(pullRequestInfo, commitInfos);

    return pullRequestInfo;
  }

  private async listReleases(from: string, to: string, quiet?: boolean): Promise<Release[]> {
    // Get all info about commits in a certain tags range
    const pullReqests = await this.getPullRequestsInfo(from, to, quiet);

    // Step 6: Group commits by release (local)
    let releases = this.groupByRelease(pullReqests, to);

    // Step 7: Compile list of committers in release (local + remote)
    await this.fillInContributors(releases);

    return releases;
  }

  private async getListOfUniquePackages(sha: string): Promise<string[]> {
    return (await Git.changedPaths(sha))
      .map(path => this.packageFromPath(path))
      .filter(Boolean)
      .filter(onlyUnique);
  }

  private packageFromPath(path: string): string {
    const parts = path.split("/");
    if (parts[0] !== "packages" || parts.length < 3) {
      return "";
    }

    if (parts.length >= 4 && parts[1][0] === "@") {
      return `${parts[1]}/${parts[2]}`;
    }

    return parts[1];
  }

  private getListOfCommits(from: string, to: string): Git.CommitListItem[] {
    // Determine the tags range to get the commits for. Custom from/to can be
    // provided via command-line options.
    // Default is "from last tag".
    return Git.listCommits(from, to);
  }

  private async getCommitters(pullRequests: any[]): Promise<GitHubAuthorResponse[]> {
    const committers: { [id: string]: GitHubAuthorResponse } = {};

    for (const pr of pullRequests) {
      const login = pr.author?.login;
      if (login && !this.ignoreCommitter(login) && !committers[login]) {
        committers[login] = pr.author;
      }
    }

    return Object.keys(committers).map(k => committers[k]);
  }

  private ignoreCommitter(login: string): boolean {
    return this.config.ignoreCommitters.some((c: string) => c === login || login.indexOf(c) > -1);
  }

  private toCommitInfos(commits: Git.CommitListItem[]): CommitInfo[] {
    return commits.map(commit => {
      const { sha, refName, summary: message, date } = commit;

      let tagsInCommit;
      if (refName.length > 1) {
        const TAG_PREFIX = "tag: ";

        // Since there might be multiple tags referenced by the same commit,
        // we need to treat all of them as a list.
        tagsInCommit = refName
          .split(", ")
          .filter(ref => ref.startsWith(TAG_PREFIX))
          .map(ref => ref.substr(TAG_PREFIX.length));
      }

      const issueNumber = findPullRequestId(message);

      return {
        commitSHA: sha,
        message,
        // Note: Only merge commits or commits referencing an issue / PR
        // will be kept in the changelog.
        tags: tagsInCommit,
        issueNumber,
        date,
      } as CommitInfo;
    });
  }

  private async downloadIssueData(commitInfos: CommitInfo[]) {
    progressBar.init("Downloading issue and PR data from GitHub…", commitInfos.length);
    await pMap(
      commitInfos,
      async (commitInfo: CommitInfo) => {
        // 1. Determine PR Number
        let prNumber = commitInfo.issueNumber ? parseInt(commitInfo.issueNumber as string, 10) : null;
        let foundPr: any = null;

        if (!prNumber) {
          const { pr } = await this.github.getPRForCommit(this.config.repo, commitInfo.commitSHA);
          if (pr && pr.merged && pr.number && this.config.baseBranchNames.includes(pr.baseRefName)) {
            foundPr = pr;
            prNumber = pr.number;
          }
        }

        if (prNumber) {
          // 2. Initialize Cache if missing
          if (!this.prCache.has(prNumber)) {
            if (!foundPr) {
              const { pr } = await this.github.getPRForCommit(this.config.repo, commitInfo.commitSHA);
              if (pr && pr.merged && pr.number && this.config.baseBranchNames.includes(pr.baseRefName)) {
                foundPr = pr;
              }
            }
            this.prCache.set(
              prNumber,
              (async () => {
                const linked = await this.github.getLinkedIssues(this.config.repo, prNumber!);
                return { pr: foundPr, linkedIssues: linked };
              })()
            );
          }

          // 3. Await the cached data
          const cachedData = await this.prCache.get(prNumber)!;

          // 4. "Late-Binding".
          // If the cache's PR object is missing but we just found it in this iteration,
          // update the cache so future commits get the full object.
          if (!cachedData.pr && foundPr) {
            cachedData.pr = foundPr;
          }

          // 5. Assign to this specific commitInfo instance.
          commitInfo.githubPr = cachedData.pr;
          commitInfo.linkedIssues = cachedData.linkedIssues;

          // Fetch Issue data if this specific commit was linked via #number.
          if (commitInfo.issueNumber && !commitInfo.githubIssue) {
            commitInfo.githubIssue = await this.github.getIssueData(this.config.repo, commitInfo.issueNumber);
          }
          progressBar.tick();
          return;
        }

        // Fallback for commits with no PR association
        if (commitInfo.issueNumber && !commitInfo.githubIssue) {
          commitInfo.githubIssue = await this.github.getIssueData(this.config.repo, commitInfo.issueNumber);
        }
        progressBar.tick();
      },
      { concurrency: 5 }
    );
    progressBar.terminate();
  }

  private groupByRelease(pullRequests: any[], to: string): Release[] {
    // Analyze the commits and group them by category.
    // This is useful to generate multiple release logs in case there are
    // multiple release tags.
    let releaseMap: { [id: string]: Release } = {};
    const tagDate = Git.getTagDate(to);

    let currentReleaseCategory = to === "HEAD" ? UNRELEASED_TAG : to;
    for (const pr of pullRequests) {
      if (pr.categories && pr.categories.length === 0) {
        continue;
      }

      if (!releaseMap[currentReleaseCategory]) {
        releaseMap[currentReleaseCategory] = { name: currentReleaseCategory, date: tagDate, pullRequests: [] };
      }

      releaseMap[currentReleaseCategory].pullRequests.push(pr);
    }

    return Object.keys(releaseMap).map(tag => releaseMap[tag]);
  }

  private groupByReleaseCommit(commits: CommitInfo[]): Release[] {
    // Analyze the commits and group them by tag.
    // This is useful to generate multiple release logs in case there are
    // multiple release tags.
    let releaseMap: { [id: string]: Release } = {};

    let currentTags = [UNRELEASED_TAG];
    for (const commit of commits) {
      if (commit.tags && commit.tags.length > 0) {
        currentTags = commit.tags;
      }

      // Tags referenced by commits are treated as a list. When grouping them,
      // we split the commits referenced by multiple tags in their own group.
      // This results in having one group of commits for each tag, even if
      // the same commits are "duplicated" across the different tags
      // referencing them.
      for (const currentTag of currentTags) {
        if (!releaseMap[currentTag]) {
          let date = currentTag === UNRELEASED_TAG ? this.getToday() : commit.date;
          // releaseMap[currentTag] = { name: currentTag, date, commits: [] };
        }

        // releaseMap[currentTag].pullRequests.push(commit);
      }
    }

    return Object.keys(releaseMap).map(tag => releaseMap[tag]);
  }

  private getToday() {
    const date = new Date().toISOString();
    return date.slice(0, date.indexOf("T"));
  }

  private extractPullRequestInfo(commits: CommitInfo[]): any[] {
    const pullRequests: any[] = [];

    const seenPullRequestNumbers: Set<number> = new Set();
    for (const commit of commits) {
      if (commit.githubPr && commit.githubPr.number && !seenPullRequestNumbers.has(commit.githubPr.number)) {
        pullRequests.push(commit.githubPr);
        seenPullRequestNumbers.add(commit.githubPr.number);
      }
    }

    return pullRequests;
  }

  private assignToCategories(pullRequests: any[], commitInfos: CommitInfo[]) {
    for (const pr of pullRequests) {
      // 1. Gather all linked issues from all commits associated with this PR.
      const linkedIssues = commitInfos.filter(c => c.githubPr?.number === pr.number).flatMap(c => c.linkedIssues || []);

      // 2. Extract unique category names from those issues.
      const categories = new Set<string>();

      for (const issue of linkedIssues) {
        const type = issue.issueType?.name?.toLowerCase();
        const category = type ? this.config.labels[type] : null;

        if (category) {
          categories.add(category);
        }
      }

      // 3. Fallback to 'uncategorized' only if no categories were found.
      if (categories.size === 0) {
        const fallback = this.config.labels["uncategorized"];
        if (fallback) categories.add(fallback);
      }

      // 4. Assign the final array to the PR.
      pr.categories = Array.from(categories);
    }
  }

  private assignToCategoriesOld(pullRequestInfo: any[], commitInfos: CommitInfo[]) {
    for (const pr of pullRequestInfo) {
      pr.categories = [];
      const relatedCommits = commitInfos.filter(c => c.githubPr && c.githubPr.number === pr.number);
      if (relatedCommits.length > 0) {
        for (const commit of relatedCommits) {
          if (commit.linkedIssues?.length === 0) {
            const category = this.config.labels["uncategorized"];
            if (category && !pr.categories.includes(category)) {
              pr.categories.push(category);
            }
          }
          for (const linkedIssue of commit.linkedIssues || []) {
            let issueType = linkedIssue.issueType?.name.toLowerCase() || "uncategorized";
            if (issueType) {
              const category = this.config.labels[issueType];
              if (category && !pr.categories.includes(category)) {
                pr.categories.push(category);
              }
            }
          }
        }
      }
    }
  }

  private fillInCategories(commits: CommitInfo[]) {
    for (const commit of commits) {
      if (
        (!commit.githubIssue || !commit.githubIssue.labels) &&
        (!commit.linkedIssues || commit.linkedIssues?.length === 0)
      ) {
        console.warn(
          `No labels or types found on anything associated with commit #${commit.commitSHA}. Skipping categorization.`
        );
        continue;
      }
      let labels: string[] = [];
      if (commit.githubIssue && commit.githubIssue.labels) {
        labels = commit.githubIssue.labels.map(label => label.name.toLowerCase());
      }
      if (commit.linkedIssues && commit.linkedIssues.length > 0) {
        commit.linkedIssues.forEach(issue => {
          let issueType = issue.issueType.name.toLowerCase();
          if (issueType && labels.indexOf(issueType) === -1) {
            labels.push(issueType);
          }
        });
      }

      if (this.config.wildcardLabel) {
        // check whether the commit has any of the labels from the learna.json config.
        // If not, label this commit with the provided label

        let foundLabel = Object.keys(this.config.labels).some(label => labels.indexOf(label.toLowerCase()) !== -1);
        commit.linkedIssues?.forEach(issue => {
          // issue.labels.nodes.forEach(l => labels.add(l.name.toLowerCase()));
          let issueLabels = issue.labels.map(label => label.name.toLowerCase());
          let issueHasLabel = Object.keys(this.config.labels).some(
            label => issueLabels.indexOf(label.toLowerCase()) !== -1
          );
          if (issueHasLabel) {
            foundLabel = true;
          }
        });

        if (!foundLabel) {
          labels.push(this.config.wildcardLabel);
        }
      }

      commit.categories = Object.keys(this.config.labels)
        .filter(label => labels.indexOf(label.toLowerCase()) !== -1)
        .map(label => this.config.labels[label]);
    }
  }

  private async fillInPackages(commits: CommitInfo[]) {
    progressBar.init("Mapping commits to packages…", commits.length);

    try {
      await pMap(
        commits,
        async (commit: CommitInfo) => {
          commit.packages = await this.getListOfUniquePackages(commit.commitSHA);

          progressBar.tick();
        },
        { concurrency: 5 }
      );
    } finally {
      progressBar.terminate();
    }
  }

  private async fillInContributors(releases: Release[]) {
    for (const release of releases) {
      release.contributors = await this.getCommitters(release.pullRequests);
    }
  }
}

function onlyUnique(value: any, index: number, self: any[]): boolean {
  return self.indexOf(value) === index;
}
