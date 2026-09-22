# Pull Requests for Paseo

Your GitHub pull requests across repositories, inside Paseo.

**My PRs** opens by default and combines open PRs you authored or are assigned to. **Awaiting my review** includes outstanding requests addressed to you or your teams. PRs that you both authored and are assigned to appear once, with both badges.

## Requirements

- Paseo **0.9.x**, on both the daemon and connected clients.
- [GitHub CLI](https://cli.github.com/) installed on the daemon host and authenticated as the user running Paseo: `gh auth login --hostname github.com`.
- GitHub access to the repositories you want to see. Private repositories and organization SSO must be authorized for that account.
- Plugins enabled in Paseo under **Settings → Plugins**.

All clients connected to a daemon see its GitHub account's PRs. Credentials stay on that host; this plugin does not ask for or store tokens. On unattended hosts, inject any GitHub environment credentials through your secret manager into the daemon process, rather than committing them or entering them in the plugin.

## Install

Install from npm on the daemon host:

```sh
paseo plugin install npm:paseo-plugin-pull-requests@0.1.0
```

Or install the same release from GitHub:

```sh
paseo plugin install github:Ironside-Software/pull-requests-paseo-plugin --ref v0.1.0
```

In **Settings → Plugins → Plugin source**, enter `npm:paseo-plugin-pull-requests`. Open **Pull Requests** in the sidebar after installation. Paseo runs trusted plugin code on the daemon and connected clients. Both installation sources require npm on the daemon host; GitHub installs prepare production dependencies from the committed lockfile.

## Filters and refresh

Open **Filters** to filter by organization or owner, repository, draft/ready status, and title text. **My PRs** also offers authored-only and assigned-only filters. Select **Apply filters** to search, or **Clear filters** to reset. Filters remain selected when switching tabs; the relationship filter only affects My PRs.

Suggestions come from loaded PRs. You can enter any owner or `owner/repository` explicitly, including repositories that have not loaded yet. Repository suggestions follow the selected owner. Search text is treated as literal title text, not raw GitHub search syntax.

Filters run on GitHub, across all matching results. Results are sorted by most recent update, with 100 per page and **Load more** for subsequent pages. Refresh runs every 60 seconds while the page is active; you can also refresh manually. Failed refreshes retain previous results and show an error.

GitHub search exposes up to 1,000 results and can return incomplete results. The page warns when this happens; narrow filters to see the remaining PRs. Search indexing can briefly lag recent GitHub changes. Accounts with restricted permissions cannot see inaccessible PRs.

Select a PR to open its detail page without losing your list, filters, or scroll position. **Overview** renders the description with Markdown and shows reviewers, checks, and merge status. **Files** has a searchable file navigator and colored diffs with old/new line numbers. **Activity** shows comments, reviews, and inline thread context; **Commits** shows the commit history; **Checks** shows check runs and commit statuses. The header and review action stay visible while scrolling. Each section paginates independently. GitHub limits changed files to 3,000 and can truncate patches; complete file links remain available.

You can comment, approve, request changes, and merge from the detail page. Select a diff line number to post a line comment, or reply to an inline thread from Activity. The review form supports Markdown preview and retains unsent text when closed. Submissions show a confirmation first. Reviews and merges check the commit you inspected; a changed head requires refreshing. GitHub enforces permissions and branch protection. The plugin never retries writes automatically. If a network error leaves the outcome uncertain, check GitHub before retrying.

## Paseo integration

- Open the dashboard from the sidebar or **Open Pull Requests** in Command Center.
- Open **Workspace Pull Requests** from Command Center or `/prs` in a workspace. Its panel starts with the workspace repository selected when GitHub metadata is available.
- **Open workspace** reuses a workspace associated with the PR. Otherwise **Create PR worktree** checks out the PR into an isolated Paseo worktree for a matching local project. Open the repository in Paseo first if no project matches.
- **Review with agent** uses a model from the daemon's available providers. The review prompt asks for findings inside Paseo and forbids posting, merging, pushing, or editing. Agent actions remain subject to Paseo's permissions.

Workspace and agent navigation use the connected Paseo host. No separate client connection or authentication is created.

## Troubleshooting

```sh
paseo plugin ls
paseo plugin logs pull-requests
```

- **Missing or expired login:** run `gh auth login` as the daemon user, then refresh.
- **Missing private repositories:** verify that account's permissions and organization SSO authorization.
- **Rate limit:** wait a few minutes before refreshing.
- **Compatibility error:** update the daemon and connected app to Paseo 0.9.x. Updating only the daemon does not update a separately hosted web client.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
paseo plugin install /absolute/path/to/pull-requests-paseo-plugin
```

After edits, run `paseo plugin reload pull-requests`. The client uses React Native and Paseo theme tokens for browser and mobile compatibility. GitHub requests run server-side through `gh api`; the shared RPC validates inputs and outputs with Zod.

Paseo supplies its SDK, React, React Native, TanStack Query, and Zod. Marked is the sole additional runtime dependency; its tokens are rendered as native components, never executed as HTML. Raw HTML is shown as text and HTML comments are hidden. Development dependencies support typechecking and tests. Git installations use the manifest's preparation command to install production dependencies. Run `npm ci --ignore-scripts` again if you need development tools after installing a local checkout.

Before publishing, run the checks above and inspect `npm pack --dry-run`. Prepare the npm package in a separate staging directory and remove the Git-only `build` field from its `paseo-plugin.json`; npm installations already install production dependencies. Pack that directory and publish the inspected tarball with `npm publish <tarball> --access public`. Tag the source commit as the package version and attach the same tarball to its GitHub release.

MIT licensed. See [LICENSE](LICENSE).
