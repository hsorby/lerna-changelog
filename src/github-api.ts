import path from "path";

import ConfigurationError from "./configuration-error.js";
import fetch from "./fetch.js";

const GRAPHQL_URL = "https://api.github.com/graphql";

export interface GitHubUserResponse {
  login: string;
  name: string;
  html_url: string;
}

export interface GitHubAuthorResponse {
  login: string;
  url: string;
  avatarUrl: string;
}

export interface GitHubPRResponse {
  number: number;
  title: string;
  url: string;
  body: string;
}

export interface GitHubIssueResponse {
  number: number;
  title: string;
  pull_request?: {
    html_url: string;
  };
  issueType: {
    name: string;
  };
  labels: Array<{
    name: string;
  }>;
  user: {
    login: string;
    html_url: string;
  };
}

export interface Options {
  repo: string;
  rootPath: string;
  cacheDir?: string;
}

export default class GithubAPI {
  private cacheDir: string | undefined;
  private auth: string;

  constructor(config: Options) {
    this.cacheDir = config.cacheDir && path.join(config.rootPath, config.cacheDir, "github");
    this.auth = this.getAuthToken();
    if (!this.auth) {
      throw new ConfigurationError("Must provide GITHUB_AUTH");
    }
  }

  public getBaseIssueUrl(repo: string): string {
    return `https://github.com/${repo}/issues/`;
  }

  public async getPRForCommit(repo: string, sha: string) {
    const [owner, name] = repo.split("/");

    const query = {
      query: `
     {
      repository(owner: "${owner}", name: "${name}") {
        object(expression: "${sha}") {
          ... on Commit {
            parents(first: 2) {
              totalCount
            }
            associatedPullRequests(first: 5) {
              nodes {
                author { ... on User { login url avatarUrl } }
                merged
                number
                title
                url
                baseRefName
                headRefName
              }
            }
          }
        }
      }
    }
  `,
    };

    const response: any = await this._post(GRAPHQL_URL, query);

    const commitData = response.data.repository.object;
    const pr = commitData?.associatedPullRequests.nodes[0];

    return {
      isMergeCommit: commitData?.parents.totalCount > 1,
      pr: pr || null,
      merged: pr ? pr.merged : false,
      baseRefName: pr ? pr.baseRefName : null,
      headRefName: pr ? pr.headRefName : null,
    };
  }

  public async getLinkedIssues(repo: string, prNumber: number) {
    const [owner, name] = repo.split("/");

    const query = {
      query: `
      { repository(owner: "${owner}", name: "${name}") {
        pullRequest(number: ${prNumber}) {
          closingIssuesReferences(first: 10) {
            nodes  { number title issueType { name }
            labels(first: 10) { nodes { name } } }
          }
        }
      }
    }`,
    };
    const response: any = await this._post(GRAPHQL_URL, query);
    return response.data.repository.pullRequest.closingIssuesReferences.nodes;
  }

  public async getIssueData(repo: string, issue: string): Promise<GitHubIssueResponse> {
    return this._fetch(`https://api.github.com/repos/${repo}/issues/${issue}`);
  }

  public async getUserData(login: string): Promise<GitHubUserResponse> {
    return this._fetch(`https://api.github.com/users/${login}`);
  }

  private async _post(url: string, body: any): Promise<any> {
    const res = await fetch(url, {
      cachePath: this.cacheDir,
      headers: {
        Authorization: `token ${this.auth}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(body),
      // redirect: "follow",
      // follow: 20,
      timeout: 0,
      // compress: true,
      // size: 0,
    });
    const parsedResponse = await res.json();
    if (res.ok) {
      return parsedResponse;
    }
    throw new ConfigurationError(`Post error: ${res.statusText}.\n${JSON.stringify(parsedResponse)}`);
  }

  private async _fetch(url: string): Promise<any> {
    const res = await fetch(url, {
      cachePath: this.cacheDir,
      headers: {
        Authorization: `token ${this.auth}`,
      },
      // method: "GET",
      // body: null,
      // redirect: "follow",
      // follow: 20,
      timeout: 0,
      // compress: true,
      // size: 0,
    });
    const parsedResponse = await res.json();
    if (res.ok) {
      return parsedResponse;
    }
    throw new ConfigurationError(`Fetch error: ${res.statusText}.\n${JSON.stringify(parsedResponse)}`);
  }

  private getAuthToken(): string {
    return process.env.GITHUB_AUTH || "";
  }
}
