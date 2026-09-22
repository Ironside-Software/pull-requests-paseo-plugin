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

Install the npm release on the daemon host:

```sh
paseo plugin install npm:paseo-plugin-pull-requests@0.1.0
```

Or install from GitHub:

```sh
paseo plugin install github:Ironside-Software/pull-requests-paseo-plugin --ref v0.1.0
```

You can also paste either source into **Settings → Plugins → Plugin source**. Open **Pull Requests** in the sidebar after installation.

## Filters and refresh

Open **Filters** to filter by organization or owner, repository, draft/ready status, and title text. **My PRs** also offers authored-only and assigned-only filters. Select **Apply filters** to search, or **Clear filters** to reset. Filters remain selected when switching tabs; the relationship filter only affects My PRs.

Suggestions come from loaded PRs. You can enter any owner or `owner/repository` explicitly, including repositories that have not loaded yet. Repository suggestions follow the selected owner. Search text is treated as literal title text, not raw GitHub search syntax.

Filters run on GitHub, across all matching results. Results are sorted by most recent update, with 100 per page and **Load more** for subsequent pages. Refresh runs every 60 seconds while the page is active; you can also refresh manually. Failed refreshes retain previous results and show an error.

GitHub search exposes up to 1,000 results and can return incomplete results. The page warns when this happens; narrow filters to see the remaining PRs. Search indexing can briefly lag recent GitHub changes. Accounts with restricted permissions cannot see inaccessible PRs.

PR links open GitHub for reviewing, commenting, and merging.

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

There are no added runtime dependencies or build steps. Paseo supplies its SDK, React, React Native, TanStack Query, and Zod. Development dependencies support typechecking and tests only.

Before publishing, run the checks above and `npm pack --dry-run`, then publish with `npm publish --access public`. Tag the same commit as the package version and create its GitHub release.

MIT licensed. See [LICENSE](LICENSE).
