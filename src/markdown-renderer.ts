import { GitHubAuthorResponse, GitHubUserResponse } from "./github-api.js";
import { CommitInfo, Release } from "./interfaces.js";

const UNRELEASED_TAG = "___unreleased___";
const COMMIT_FIX_REGEX = /(fix|close|resolve)(e?s|e?d)? [T#](\d+)/i;

interface CategoryInfo {
  name: string | undefined;
  pullRequests: any[];
}

interface Options {
  categories: string[];
  baseIssueUrl: string;
  unreleasedName: string;
}

export default class MarkdownRenderer {
  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  public renderMarkdown(releases: Release[]) {
    let output = releases
      .map(release => this.renderRelease(release))
      .filter(Boolean)
      .join("\n\n\n");
    return output ? `\n${output}` : "";
  }

  public renderRelease(release: Release): string | undefined {
    // Group commits in release by category
    const categories = this.groupByCategory(release.pullRequests);
    const releaseTitle = release.name === UNRELEASED_TAG ? this.options.unreleasedName : release.name;
    const releasePreText = release.name === UNRELEASED_TAG ? `###### Includes changes up to ` : `###### Released on `;

    let markdown = `## ${releaseTitle}\n${releasePreText}${release.date}`;

    for (const category of categories) {
      if (category.pullRequests.length === 0) continue;
      markdown += `\n\n#### ${category.name}\n`;

      markdown += this.renderMergedPullRequests(category.pullRequests);

      if (release.contributors?.length) {
        markdown += `\n\n${this.renderContributorList(release.contributors)}`;
      }
    }

    return markdown;
  }

  public renderMergedPullRequests(pullRequests: any[]) {
    let markdown = "";
    for (const pr of pullRequests) {
      markdown += `* ${pr.title} by [@${pr.author.login}](${pr.author.url}) in [#${pr.number}](${pr.url})\n`;
    }
    return markdown;
  }

  public renderContributionsByPackage(pullRequests: any[]) {
    // Group commits in category by package
    const commitsByPackage: { [id: string]: any[] } = {};
    for (const commit of pullRequests) {
      // Array of unique packages.
      const changedPackages = commit.packages || [];

      const packageName = this.renderPackageNames(changedPackages);

      commitsByPackage[packageName] = commitsByPackage[packageName] || [];
      commitsByPackage[packageName].push(commit);
    }

    const packageNames = Object.keys(commitsByPackage);

    return packageNames
      .map(packageName => {
        const pkgCommits = commitsByPackage[packageName];
        return `* ${packageName}\n${this.renderContributionList(pkgCommits, "  ")}`;
      })
      .join("\n");
  }

  public renderPackageNames(packageNames: string[]) {
    return packageNames.length > 0 ? packageNames.map(pkg => `\`${pkg}\``).join(", ") : "Other";
  }

  public renderContributionList(commits: CommitInfo[], prefix: string = ""): string {
    return commits
      .map(commit => this.renderContribution(commit))
      .filter(Boolean)
      .map(rendered => `${prefix}* ${rendered}`)
      .join("\n");
  }

  public renderContribution(commit: CommitInfo): string | undefined {
    const issue = commit.githubIssue;
    if (issue) {
      let markdown = "";

      if (issue.number && issue.pull_request && issue.pull_request.html_url) {
        const prUrl = issue.pull_request.html_url;
        markdown += `[#${issue.number}](${prUrl}) `;
      }

      if (issue.title && issue.title.match(COMMIT_FIX_REGEX)) {
        issue.title = issue.title.replace(COMMIT_FIX_REGEX, `Closes [#$3](${this.options.baseIssueUrl}$3)`);
      }

      markdown += `${issue.title} ([@${issue.user.login}](${issue.user.html_url}))`;

      return markdown;
    }
  }

  public renderContributorList(contributors: GitHubAuthorResponse[]) {
    const list = contributors
      .map(user => {
        const avatarUrl = `${user.avatarUrl}&s=100`;
        // We use <sub> for the name and <br> to stack them
        // Non-breaking spaces (&nbsp;) help prevent the name from wrapping awkwardly
        return `
<kbd>
  <a href="${user.url}">
    <img src="${avatarUrl}" width="50" height="50"><br>
    <sub>@${user.login}</sub>
  </a>
</kbd>`.trim();
      })
      .join(" ");

    return `#### Contributors\n\n${list}\n`;
  }

  public renderContributorList2(contributors: GitHubAuthorResponse[]) {
    if (contributors.length === 0) return "";

    const COLUMNS_PER_ROW = 6;
    let markdown = "#### Contributors\n\n";

    // Split contributors into rows
    for (let i = 0; i < contributors.length; i += COLUMNS_PER_ROW) {
      const chunk = contributors.slice(i, i + COLUMNS_PER_ROW);

      // Row 1: The Avatars
      markdown +=
        "| " +
        chunk
          .map(user => {
            const avatarUrl = `${user.avatarUrl}&s=100`; // Request 100px for clarity
            return `<a href="${user.url}"><img src="${avatarUrl}" width="50" height="50" alt="@${user.login}"></a>`;
          })
          .join(" | ") +
        " |\n";

      // Row 2: The Alignment/Dividers
      markdown += "| " + chunk.map(() => ":---:").join(" | ") + " |\n";

      // Row 3: The Logins (Captions)
      markdown +=
        "| " +
        chunk
          .map(user => {
            return `[@${user.login}](${user.url})`;
          })
          .join(" | ") +
        " |\n\n";
    }

    return markdown;
  }

  public renderContributor(contributor: GitHubAuthorResponse): string {
    return `![avatar](${contributor.avatarUrl}) [@${contributor.login}](${contributor.url})`;
  }

  private hasPackages(pullRequests: any[]) {
    return pullRequests.some(pr => pr.packages !== undefined && pr.packages.length > 0);
  }

  private groupByCategory(allPullRequests: any[]): CategoryInfo[] {
    return this.options.categories.map(name => {
      // Keep only the commits that have a matching label with the one
      // provided in the lerna.json config.
      let pullRequests = allPullRequests.filter(pr => pr.categories && pr.categories.indexOf(name) !== -1);
      return { name, pullRequests };
    });
  }
}
