# Pull Requests for Paseo

Browse and review GitHub pull requests in Paseo, including private repositories.

![Pull request list](images/dashboard.png)
![Pull request overview](images/pr-details.png)
![File diff](images/files-diff.png)

## Installation

Requires Paseo **0.9.x**, npm, and GitHub CLI on the daemon host. Enable **Settings → Plugins**, then run as the daemon user:

```sh
gh auth login --hostname github.com
paseo plugin install npm:paseo-plugin-pull-requests
```

Open **Pull Requests** in the sidebar. Connected clients use the daemon's GitHub account.

## Features

- Authored, assigned, and requested-review PRs with search and filters.
- Descriptions, diffs, comments, reviews, commits, checks, and merging.
- Workspace header **PR** button, visible only when Paseo reports a linked PR.
- Sidebar, Command Center, and workspace panels.
- Reuse or create PR workspaces; launch Terminal, Codex, Claude, or other ready providers from the **Paseo** menu. Terminal opens its workspace; select the terminal tab manually.
