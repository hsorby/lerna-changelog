import { GitHubAuthorResponse, GitHubIssueResponse, GitHubPRResponse, GitHubUserResponse } from "./github-api.js";

export interface CommitInfo {
  commitSHA: string;
  message: string;
  tags?: string[];
  date: string;
  issueNumber: string | null;
  githubIssue?: GitHubIssueResponse;
  githubPr?: GitHubPRResponse;
  categories?: string[];
  packages?: string[];
  linkedIssues?: GitHubIssueResponse[];
}

export interface Release {
  name: string;
  date?: string;
  pullRequests: GitHubPRResponse[];
  contributors?: GitHubAuthorResponse[];
}
