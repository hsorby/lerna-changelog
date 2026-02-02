# @hsorby/changelog

A streamlined changelog generator that maps GitHub **Issue Types** to categorized release notes. Unlike standard generators that rely on PR labels, this tool looks at the issues linked to your Pull Requests to determine where changes belong.

## Usage

```bash
# Run via npx
npx @hsorby/changelog --from v1.0.0

# Or via yarn
yarn lerna-changelog --from v1.0.0

```

### How it works

1. **Finds Commits:** Identifies all commits between your specified tags on the target ref, default main.
2. **Links PRs:** Maps those commits back to their parent Pull Requests.
3. **Inspects Issues:** Looks at the **Issues** linked to those PRs.
4. **Categorizes:** Matches the `issueType` of the linked issue against your configuration to place the change in the correct section (e.g., Bug Fix, Feature).

---

## Configuration

Add a `changelog` key to your `package.json`. Even though the key is still called `labels`, it now maps to the **Type** field found in your GitHub Issues (this should change in the future).

```json
{
  "changelog": {
    "repo": "hsorby/my-project",
    "labels": {
      "feature": "🚀 New Features",
      "bug": "🐛 Bug Fixes",
      "documentation": "📝 Documentation",
      "internal": "🏠 Internal Task"
    },
    "ignoreCommitters": [
      "dependabot",
      "github-actions"
    ]
  }
}

```

The repo key is optional, the package will try and determine the repository from the repo key in the package.json itself.

### Options

| Option | Description |
| --- | --- |
| `repo` | Your `org/repo` (Inferred from package.json if omitted). |
| `nextVersion` | The header for the latest changes (e.g., `Latest Changes`). |
| `labels` | **Maps Issue Types** to Section Headers. |
| `ignoreCommitters` | Array of usernames to exclude from the contributor list. |

---

## Enhanced Features

### 📸 Clean Contributor Grids

No more messy inline lists. This fork renders a clean, centered grid of contributors with high-resolution avatars:

| <img src="[https://github.com/hsorby.png](https://www.google.com/search?q=https://github.com/hsorby.png)" width="50"> | <img src="[https://github.com/octocat.png](https://www.google.com/search?q=https://github.com/octocat.png)" width="50"> |
| --- | --- |
| [@hsorby](https://www.google.com/search?q=...) | [@octocat](https://www.google.com/search?q=...) |

### 🌳 Branch Awareness

The generator uses a target reference to ensure that only commits belonging to your primary branch are included, preventing "noise" from unmerged or side-feature branches.

### ⚡ Smart Caching

Includes an internal caching layer to prevent redundant GitHub API calls when multiple commits belong to the same Pull Request.

---

## GitHub Token

To avoid API rate limiting, export a personal access token:

```bash
export GITHUB_AUTH="your_token_here"

```

Requires `public_repo` scope for public repositories.

---

## License

[MIT ©](https://mit-license.org/) 
