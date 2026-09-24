import { z } from "zod";
import { actionSchema, detailsSchema, editSchema, labelSchema, prKeySchema, shaSchema, type PrAction, type PrEdit, type PrKey } from "../shared/details";
import { runGh } from "./github";

export type GitHubApi = typeof runGh;
const user = z.object({ login: z.string() });
const textHeader = ["-H", "Accept: application/vnd.github+json"];
const coreSchema = z.object({
  title: z.string(), html_url: z.string(), body_text: z.string().nullable().optional(), body: z.string().nullable().optional(),
  user: user.nullable(), state: z.enum(["open", "closed"]), merged: z.boolean(), draft: z.boolean(), merge_commit_sha: shaSchema.nullable().optional(),
  head: z.object({ ref: z.string(), sha: shaSchema }), base: z.object({ ref: z.string() }),
  additions: z.number(), deletions: z.number(), changed_files: z.number(), commits: z.number(), updated_at: z.string(),
  labels: z.array(labelSchema), assignees: z.array(user), requested_reviewers: z.array(user),
  requested_teams: z.array(z.object({ slug: z.string() })), mergeable: z.boolean().nullable(), mergeable_state: z.string(),
});
const repoSchema = z.object({ archived: z.boolean(), permissions: z.object({ push: z.boolean().optional() }).optional(), allow_squash_merge: z.boolean().optional(), allow_merge_commit: z.boolean().optional(), allow_rebase_merge: z.boolean().optional() });
const endpoint = (key: PrKey) => { const parsed = prKeySchema.parse(key); return `repos/${parsed.repository}/pulls/${parsed.number}`; };

export async function getDetails(input: PrKey, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input);
  const [raw, account, repository] = await Promise.all([api([endpoint(key), ...textHeader]), api(["user"]), api([`repos/${key.repository}`])]);
  const pr = coreSchema.parse(raw), login = user.parse(account).login, repo = repoSchema.parse(repository);
  return detailsSchema.parse({ ...key, title: pr.title, url: pr.html_url, body: pr.body ?? pr.body_text ?? "", author: pr.user?.login ?? "Deleted user", login,
    state: pr.merged ? "merged" : pr.state, draft: pr.draft, head: pr.head.ref, base: pr.base.ref, headSha: pr.head.sha, mergeSha: pr.state === "open" ? pr.merge_commit_sha ?? null : null,
    additions: pr.additions, deletions: pr.deletions, files: pr.changed_files, commits: pr.commits, updatedAt: pr.updated_at,
    labels: pr.labels, assignees: pr.assignees.map(u => u.login), reviewers: [...pr.requested_reviewers.map(u => u.login), ...pr.requested_teams.map(t => `@${key.repository.split("/")[0]}/${t.slug}`)],
    mergeable: pr.mergeable, mergeState: pr.mergeable_state,
    canMerge: !repo.archived && !!repo.permissions?.push && pr.state === "open" && !pr.draft && pr.mergeable !== false,
    canReview: !repo.archived && pr.state === "open" && !pr.draft && pr.user?.login.toLowerCase() !== login.toLowerCase(),
    mergeMethods: [repo.allow_squash_merge && "squash", repo.allow_merge_commit && "merge", repo.allow_rebase_merge && "rebase"].filter(Boolean),
  });
}

const fileRaw = z.object({ filename: z.string(), previous_filename: z.string().optional(), status: z.string(), additions: z.number(), deletions: z.number(), patch: z.string().optional(), blob_url: z.string() });
export async function getFiles(input: PrKey & { page: number }, api: GitHubApi = runGh) {
  const page = z.number().int().min(1).max(30).parse(input.page);
  const raw = z.array(fileRaw).parse(await api([`${endpoint(input)}/files`, "-f", "per_page=100", "-f", `page=${page}`]));
  return { items: raw.map(f => ({ path: f.filename, previousPath: f.previous_filename ?? null, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null, url: f.blob_url })), page, hasMore: raw.length === 100 && page < 30,
    warning: page === 30 && raw.length === 100 ? "GitHub exposes at most 3,000 changed files. Open GitHub for the complete change." : null };
}
export async function getLabels(input: PrKey & { page: number }, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input), page = z.number().int().min(1).max(1000).parse(input.page);
  const raw = z.array(labelSchema).parse(await api([`repos/${key.repository}/labels`, "-f", "per_page=100", "-f", `page=${page}`]));
  return { items: raw, page, hasMore: raw.length === 100 };
}
export async function getBranches(input: PrKey & { page: number }, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input), page = z.number().int().min(1).max(1000).parse(input.page);
  const raw = z.array(z.object({ name: z.string() })).parse(await api([`repos/${key.repository}/branches`, "-f", "per_page=100", "-f", `page=${page}`]));
  return { items: raw.map(branch => branch.name), page, hasMore: raw.length === 100 };
}
export async function getPreview(input: PrKey & { headSha: string; mergeSha: string | null }, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input), shas = [...new Set([shaSchema.parse(input.headSha), input.mergeSha ? shaSchema.parse(input.mergeSha) : null].filter((sha): sha is string => !!sha))];
  const schema = z.array(z.object({ id: z.number(), sha: shaSchema, environment: z.string(), production_environment: z.boolean().optional(), created_at: z.string() }));
  const raw = (await Promise.all(shas.map(sha => api([`repos/${key.repository}/deployments`, "-f", `sha=${sha}`, "-f", "per_page=100"])))).flatMap(value => schema.parse(value));
  const latest = new Map<string, (typeof raw)[number]>();
  for (const deployment of raw.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!shas.some(sha => deployment.sha.toLowerCase() === sha.toLowerCase()) || deployment.production_environment || deployment.environment.toLowerCase() === "production") continue;
    const environment = deployment.environment.toLowerCase();
    if (!latest.has(environment)) latest.set(environment, deployment);
  }
  for (const deployment of latest.values()) {
    const statuses = z.array(z.object({ state: z.string(), environment_url: z.string().nullish(), created_at: z.string() })).parse(
      await api([`repos/${key.repository}/deployments/${deployment.id}/statuses`, "-f", "per_page=100"]));
    const current = statuses.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (current?.state !== "success" || !current.environment_url) continue;
    try {
      const url = new URL(current.environment_url);
      if (url.protocol === "https:" && !url.username && !url.password) return { url: url.toString(), environment: deployment.environment };
    } catch { /* Invalid provider URL: keep looking. */ }
  }
  return { url: null, environment: null };
}

export async function getPreviewForPr(input: PrKey, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input);
  const raw = z.object({ head: z.object({ sha: shaSchema }), merge_commit_sha: shaSchema.nullable().optional(), state: z.string() }).parse(await api([endpoint(key)]));
  return getPreview({ ...key, headSha: raw.head.sha, mergeSha: raw.state === "open" ? raw.merge_commit_sha ?? null : null }, api);
}

export async function editPullRequest(input: PrEdit, api: GitHubApi = runGh) {
  const action = editSchema.parse(input), key = prKeySchema.parse(action);
  const issue = `repos/${key.repository}/issues/${key.number}`, pull = endpoint(key);
  if (action.action === "change-base") {
    const current = z.object({ state: z.string(), base: z.object({ ref: z.string() }) }).parse(await api([pull]));
    if (current.state !== "open") throw new Error("Only open pull requests can change target branch.");
    if (current.base.ref !== action.expectedBase) throw new Error("The target branch changed. Refresh the PR before trying again.");
    if (action.base === current.base.ref) return { message: "Target branch is already selected." };
    const updated = z.object({ base: z.object({ ref: z.string() }) }).parse(await api([pull, "-f", `base=${action.base}`], "PATCH"));
    if (updated.base.ref !== action.base) throw new Error("GitHub did not change the target branch. Refresh and try again.");
    return { message: `Target branch changed to ${action.base}.` };
  }
  if (action.action === "add-label" || action.action === "remove-label") {
    const result = await api(action.action === "add-label" ? [`${issue}/labels`, "-f", `labels[]=${action.name}`] : [`${issue}/labels/${encodeURIComponent(action.name)}`], action.action === "add-label" ? "POST" : "DELETE");
    const names = z.array(z.object({ name: z.string() })).parse(result).map(label => label.name.toLowerCase());
    if (names.includes(action.name.toLowerCase()) !== (action.action === "add-label")) throw new Error("GitHub did not update the label. Check repository permissions and refresh.");
  }
  if (action.action === "add-assignee" || action.action === "remove-assignee") {
    const result = z.object({ assignees: z.array(user) }).parse(await api([`${issue}/assignees`, "-f", `assignees[]=${action.name}`], action.action === "add-assignee" ? "POST" : "DELETE"));
    if (result.assignees.some(assignee => assignee.login.toLowerCase() === action.name.toLowerCase()) !== (action.action === "add-assignee")) throw new Error("GitHub did not update the assignee. Check repository permissions and refresh.");
  }
  if (action.action === "add-reviewer" || action.action === "remove-reviewer") {
    const team = action.name.startsWith("@"), [owner, slug] = action.name.slice(1).split("/");
    if (team && owner.toLowerCase() !== key.repository.split("/")[0].toLowerCase()) throw new Error("Reviewer team must belong to this repository's organization.");
    const result = z.object({ requested_reviewers: z.array(user), requested_teams: z.array(z.object({ slug: z.string() })) }).parse(
      await api([`${pull}/requested_reviewers`, "-f", `${team ? "team_reviewers" : "reviewers"}[]=${team ? slug : action.name}`], action.action === "add-reviewer" ? "POST" : "DELETE"));
    const present = team ? result.requested_teams.some(entry => entry.slug.toLowerCase() === slug.toLowerCase()) : result.requested_reviewers.some(entry => entry.login.toLowerCase() === action.name.toLowerCase());
    if (present !== (action.action === "add-reviewer")) throw new Error("GitHub did not update the review request. Check repository permissions and refresh.");
  }
  return { message: "Pull request updated." };
}
const activityRaw = z.object({ id: z.number(), user: user.nullable(), body_text: z.string().nullable().optional(), body: z.string().nullable().optional(), state: z.string().optional(), path: z.string().optional(), created_at: z.string().optional(), submitted_at: z.string().nullable().optional(), html_url: z.string(), in_reply_to_id: z.number().optional(), line: z.number().nullable().optional(), original_line: z.number().optional(), diff_hunk: z.string().optional() });
export async function getActivity(input: PrKey & { page: number }, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input), page = z.number().int().positive().max(1000).parse(input.page);
  const paths = [`repos/${key.repository}/issues/${key.number}/comments`, `${endpoint(key)}/reviews`, `${endpoint(key)}/comments`];
  const groups = await Promise.all(paths.map(path => api([path, ...textHeader, "-f", "per_page=100", "-f", `page=${page}`]).then(value => z.array(activityRaw).parse(value))));
  const kinds = ["comment", "review", "inline"] as const;
  return { items: groups.flatMap((group, index) => group.filter(item => item.state !== "PENDING").map(item => ({ id: `${kinds[index]}-${item.id}`, kind: kinds[index], author: item.user?.login ?? "Deleted user", body: item.body ?? item.body_text ?? "", state: item.state ?? null, path: item.path ?? null, commentId: kinds[index] === "inline" ? item.id : null, replyTo: item.in_reply_to_id ?? null, line: item.line ?? item.original_line ?? null, diffHunk: item.diff_hunk ?? null, date: item.submitted_at ?? item.created_at ?? "", url: item.html_url }))).sort((a,b) => a.date.localeCompare(b.date)), page, hasMore: groups.some(group => group.length === 100) };
}
export async function getChecks(input: PrKey & { headSha: string; page: number }, api: GitHubApi = runGh) {
  const key = prKeySchema.parse(input), sha = shaSchema.parse(input.headSha), page = z.number().int().positive().max(1000).parse(input.page);
  const base = `repos/${key.repository}/commits/${sha}`, paging = ["-f", "per_page=100", "-f", `page=${page}`];
  const [runs, statuses] = await Promise.allSettled([api([`${base}/check-runs`, ...paging]), api([`${base}/status`, ...paging])]);
  const warnings: string[] = [];
  const items: { id: string; name: string; status: string; url: string | null }[] = [];
  let hasMore = false;
  if (runs.status === "fulfilled") {
    const data = z.object({ total_count: z.number(), check_runs: z.array(z.object({ id: z.number(), name: z.string(), status: z.string(), conclusion: z.string().nullable(), html_url: z.string().nullable() })) }).parse(runs.value);
    items.push(...data.check_runs.map(r => ({ id: `check-${r.id}`, name: r.name, status: r.conclusion ?? r.status, url: r.html_url })));
    hasMore = page * 100 < data.total_count;
  } else warnings.push("Check runs could not be loaded. Verify GitHub access and refresh.");
  if (statuses.status === "fulfilled") {
    const data = z.object({ total_count: z.number(), statuses: z.array(z.object({ id: z.number(), context: z.string(), state: z.string(), target_url: z.string().nullable() })) }).parse(statuses.value);
    items.push(...data.statuses.map(s => ({ id: `status-${s.id}`, name: s.context, status: s.state, url: s.target_url?.startsWith("https://") ? s.target_url : null })));
    hasMore ||= page * 100 < data.total_count;
  } else warnings.push("Commit statuses could not be loaded. Verify GitHub access and refresh.");
  return { items, page, hasMore, warnings };
}

export async function performAction(input: PrAction, api: GitHubApi = runGh) {
  const action = actionSchema.parse(input), path = endpoint(action);
  if (action.action === "comment") {
    await api([`repos/${action.repository}/issues/${action.number}/comments`, "-f", `body=${action.body}`], "POST");
    return { message: "Comment posted to GitHub." };
  }
  if (action.action === "reply") {
    await api([`${path}/comments/${action.replyTo}/replies`, "-f", `body=${action.body}`], "POST");
    return { message: "Reply posted to GitHub." };
  }
  const current = z.object({ state: z.string(), draft: z.boolean(), head: z.object({ sha: shaSchema }) }).parse(await api([path]));
  if (current.state !== "open") throw new Error("This PR is no longer open. Refresh its details.");
  if (current.draft && action.action !== "inline-comment") throw new Error("This PR is a draft. Mark it ready for review on GitHub first.");
  if (current.head.sha !== action.headSha) throw new Error("New commits were pushed. Refresh and review the latest changes before submitting.");
  if (action.action === "inline-comment") {
    await api([`${path}/comments`, "-f", `body=${action.body}`, "-f", `commit_id=${action.headSha}`, "-f", `path=${action.path}`, "-F", `line=${action.line}`, "-f", `side=${action.side}`], "POST");
    return { message: "Line comment posted to GitHub." };
  }
  if (action.action === "merge") {
    const result = z.object({ merged: z.boolean() }).parse(await api([`${path}/merge`, "-f", `sha=${action.headSha}`, "-f", `merge_method=${action.method}`], "PUT"));
    if (!result.merged) throw new Error("GitHub did not merge this PR. Refresh and check branch protection requirements.");
    return { message: "Pull request merged." };
  }
  await api([`${path}/reviews`, "-f", `event=${action.action === "approve" ? "APPROVE" : "REQUEST_CHANGES"}`, "-f", `body=${action.body}`, "-f", `commit_id=${action.headSha}`], "POST");
  return { message: action.action === "approve" ? "Review approved on GitHub." : "Changes requested on GitHub." };
}

export async function getCommits(input: PrKey & { page: number }, api: GitHubApi = runGh) {
  const page = z.number().int().min(1).max(3).parse(input.page);
  const raw = z.array(z.object({ sha: shaSchema, html_url: z.string(), author: user.nullable(), commit: z.object({ message: z.string(), author: z.object({ name: z.string(), date: z.string() }).nullable() }) })).parse(await api([`${endpoint(input)}/commits`, "-f", "per_page=100", "-f", `page=${page}`]));
  return { items: raw.map(item => ({ sha: item.sha, url: item.html_url, message: item.commit.message, author: item.author?.login ?? item.commit.author?.name ?? "Deleted user", date: item.commit.author?.date ?? "" })), page, hasMore: page < 3 && raw.length === 100, warning: page === 3 && raw.length >= 50 ? "GitHub returns at most 250 commits. Open GitHub for the full history." : null };
}
