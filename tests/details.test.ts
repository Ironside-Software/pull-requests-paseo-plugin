import assert from "node:assert/strict";
import { test } from "node:test";
import { actionSchema, prKeySchema } from "../shared/details";
import { getDetails, getFiles, getActivity, getChecks, getCommits, performAction, getPreview, getPreviewForPr, getLabels, getBranches, editPullRequest, type GitHubApi } from "../server/details";
import { createReviewWorkspace, githubRepository, listWorkspaces, matchingProjects, matchingWorkspaces } from "../client/integration";
import type { PaseoApi, PaseoWorkspace } from "@getpaseo/client";

const key = { repository: "org/repo", number: 12 }, sha = "a".repeat(40);
const core = { title: "Review me", html_url: "https://github.com/org/repo/pull/12", body_text: "Readable description", user: { login: "someone" }, state: "open", merged: false, draft: false, head: { ref: "feature", sha }, base: { ref: "main" }, additions: 2, deletions: 1, changed_files: 1, commits: 1, updated_at: "2026-09-22T00:00:00Z", labels: [{ name: "bug", color: "d73a4a" }], assignees: [], requested_reviewers: [{ login: "me" }], requested_teams: [{ slug: "reviewers" }], mergeable: true, mergeable_state: "clean" };
const api: GitHubApi = async args => args[0] === "user" ? { login: "me" } : args[0] === "repos/org/repo" ? { archived: false, permissions: { push: true }, allow_squash_merge: true } : core;

test("details normalize permissions, teams, state and text; self and archived reviews disabled", async () => {
  const result = await getDetails(key, api);
  assert.equal(result.body, "Readable description"); assert.deepEqual(result.reviewers, ["me", "@org/reviewers"]);
  assert.deepEqual(result.labels, [{ name: "bug", color: "d73a4a" }]);
  assert.deepEqual(result.mergeMethods, ["squash"]); assert.equal(result.canMerge, true); assert.equal(result.canReview, true);
  const self = await getDetails(key, async args => args[0] === "user" ? { login: "someone" } : api(args));
  assert.equal(self.canReview, false);
  const archived = await getDetails(key, async args => args[0] === "repos/org/repo" ? { archived: true, permissions: { push: true } } : api(args));
  assert.equal(archived.canMerge, false); assert.equal(archived.canReview, false);
});
test("writes validate input, use explicit methods, and guard reviews/merges against new commits", async () => {
  const calls: { args: string[]; method: string }[] = [];
  const write: GitHubApi = async (args, method = "GET") => { calls.push({ args, method }); return method === "GET" ? core : { merged: true }; };
  await performAction({ ...key, action: "comment", body: "hello $(not-a-shell)" }, write);
  assert.deepEqual(calls.pop(), { args: ["repos/org/repo/issues/12/comments", "-f", "body=hello $(not-a-shell)"], method: "POST" });
  await performAction({ ...key, action: "approve", body: "", headSha: sha }, write);
  assert.equal(calls.at(-1)?.method, "POST"); assert.ok(calls.at(-1)?.args.includes("event=APPROVE")); assert.ok(calls.at(-1)?.args.includes(`commit_id=${sha}`));
  await performAction({ ...key, action: "request-changes", body: "Add tests", headSha: sha }, write);
  assert.ok(calls.at(-1)?.args.includes("event=REQUEST_CHANGES"));
  await performAction({ ...key, action: "merge", method: "squash", headSha: sha }, write);
  assert.equal(calls.at(-1)?.method, "PUT"); assert.ok(calls.at(-1)?.args.includes(`sha=${sha}`));
  for (const override of [{ head: { sha: "b".repeat(40) } }, { draft: true }, { state: "closed" }]) {
    let writes = 0;
    await assert.rejects(performAction({ ...key, action: "merge", method: "merge", headSha: sha }, async (_, method = "GET") => { if (method !== "GET") writes++; return { ...core, ...override }; }));
    assert.equal(writes, 0);
  }
  await assert.rejects(performAction({ ...key, action: "merge", method: "merge", headSha: sha }, async (_, method = "GET") => method === "GET" ? core : { merged: false }), /did not merge/);
  await assert.rejects(performAction({ ...key, action: "comment", body: "Hello" }, async () => { throw new Error("rate limit"); }), /rate limit/);
  assert.equal(actionSchema.safeParse({ ...key, action: "comment", body: "  " }).success, false);
  assert.equal(prKeySchema.safeParse({ repository: "org/../escape", number: 1 }).success, false);
});
test("paginated files, discussion and partially unavailable checks expose completeness", async () => {
  const file = { filename: "file.bin", status: "added", additions: 0, deletions: 0, blob_url: "https://github.com/org/repo/blob/main/file.bin" };
  const files = await getFiles({ ...key, page: 30 }, async () => Array(100).fill(file));
  assert.equal(files.hasMore, false); assert.match(files.warning!, /3,000/); assert.equal(files.items[0].patch, null);
  const activity = await getActivity({ ...key, page: 1 }, async args => args[0].endsWith("reviews") ? [{ id: 1, user: null, state: "PENDING", html_url: core.html_url }] : [{ id: 2, user: { login: "reviewer" }, body_text: "Comment", created_at: core.updated_at, html_url: core.html_url }]);
  assert.deepEqual(activity.items.map(item => item.kind), ["comment", "inline"]);
  const checks = await getChecks({ ...key, headSha: sha, page: 1 }, async args => { if (args[0].endsWith("check-runs")) throw new Error("no permission"); return { total_count: 101, statuses: [{ id: 1, context: "CI", state: "success", target_url: "javascript:alert(1)" }] }; });
  assert.equal(checks.warnings.length, 1); assert.equal(checks.hasMore, true); assert.equal(checks.items[0].url, null);
});
test("Paseo integration matches exact GitHub repositories and creates isolated PR worktrees", async () => {
  assert.equal(githubRepository("git@github.com:Org/Repo.git"), "org/repo");
  assert.equal(githubRepository("https://github.com/org/repo"), "org/repo");
  assert.equal(githubRepository("https://github.com.evil/org/repo"), null);
  const workspace = { id: "w1", projectId: "p1", gitRuntime: { remoteUrl: "git@github.com:org/repo.git" }, githubRuntime: { pullRequest: { url: core.html_url } }, archivingAt: null } as PaseoWorkspace;
  const pr = await getDetails(key, api);
  assert.equal(matchingWorkspaces([workspace], pr).length, 1); assert.equal(matchingProjects([workspace], "org/repo").length, 1);
  assert.equal(matchingProjects([workspace], "org/another").length, 0);
  let options: unknown;
  const paseo = { workspaces: { create: async (input: unknown) => { options = input; return { id: "created" }; }, list: async (input: { page: { cursor?: string } }) => input.page.cursor ? { entries: [workspace], pageInfo: {} } : { entries: [], pageInfo: { nextCursor: "page2" } } } } as unknown as PaseoApi;
  assert.equal((await listWorkspaces(paseo)).length, 1);
  await createReviewWorkspace(paseo, pr, "p1");
  assert.deepEqual(options, { title: "repo #12", source: { kind: "worktree", projectId: "p1", action: "checkout", checkoutSource: { kind: "change_request", forge: "github", number: 12, projectPath: "org/repo" } } });
});

test("line comments pin the reviewed SHA and replies target their original thread", async () => {
  const calls: { args: string[]; method: string }[] = [];
  const write: GitHubApi = async (args, method = "GET") => { calls.push({ args, method }); return { ...core, draft: true }; };
  await performAction({ ...key, action: "inline-comment", body: "Check this line", path: "src/app.ts", line: 42, side: "RIGHT", headSha: sha }, write);
  assert.deepEqual(calls.at(-1), { args: ["repos/org/repo/pulls/12/comments", "-f", "body=Check this line", "-f", `commit_id=${sha}`, "-f", "path=src/app.ts", "-F", "line=42", "-f", "side=RIGHT"], method: "POST" });
  await performAction({ ...key, action: "reply", body: "Agreed", replyTo: 99 }, write);
  assert.deepEqual(calls.at(-1), { args: ["repos/org/repo/pulls/12/comments/99/replies", "-f", "body=Agreed"], method: "POST" });
  let writes = 0;
  await assert.rejects(performAction({ ...key, action: "inline-comment", body: "Old change", path: "file.ts", line: 1, side: "LEFT", headSha: sha }, async (_, method = "GET") => { if (method !== "GET") writes++; return { ...core, head: { sha: "b".repeat(40) } }; }), /New commits/);
  assert.equal(writes, 0);
  assert.equal(actionSchema.safeParse({ ...key, action: "inline-comment", body: "Test", path: "src/a", line: 0, side: "RIGHT", headSha: sha }).success, false);
});

test("commit history pagination and inline-thread context are preserved", async () => {
  const commit = { sha, html_url: "https://github.com/org/repo/commit/" + sha, author: null, commit: { message: "Subject\n\nBody", author: { name: "Author", date: core.updated_at } } };
  const result = await getCommits({ ...key, page: 3 }, async args => { assert.ok(args.includes("page=3")); return Array(50).fill(commit); });
  assert.equal(result.hasMore, false); assert.match(result.warning!, /250/); assert.equal(result.items[0].author, "Author");
  const activity = await getActivity({ ...key, page: 1 }, async args => args[0] === "repos/org/repo/pulls/12/comments" ? [{ id: 45, in_reply_to_id: 42, user: { login: "me" }, body: "**Reply**", path: "file.ts", line: 9, diff_hunk: "@@ -8 +8 @@\n context", created_at: core.updated_at, html_url: core.html_url }] : []);
  assert.equal(activity.items[0].replyTo, 42); assert.equal(activity.items[0].line, 9); assert.equal(activity.items[0].body, "**Reply**"); assert.equal(activity.items[0].commentId, 45);
});

test("preview uses the latest successful non-production deployment for the current head", async () => {
  const deploy = (id: number, environment: string, created_at: string) => ({ id, environment, created_at, sha, production_environment: environment === "production" });
  const deployments = [deploy(1, "Preview", "2026-09-21"), deploy(2, "Preview", "2026-09-22"), deploy(3, "production", "2026-09-23")];
  const preview = await getPreview({ ...key, headSha: sha, mergeSha: null }, async args => args[0].endsWith("/deployments") ? deployments : args[0].includes("/2/") ? [{ state: "success", environment_url: "https://preview.example.test", created_at: "2026-09-22" }] : []);
  assert.equal(preview.url, "https://preview.example.test/");
  const missing = await getPreview({ ...key, headSha: sha, mergeSha: null }, async args => args[0].endsWith("/deployments") ? deployments : [{ state: "inactive", environment_url: "https://old.example.test", created_at: "2026-09-23" }]);
  assert.equal(missing.url, null);
  const unsafe = await getPreview({ ...key, headSha: sha, mergeSha: null }, async args => args[0].endsWith("/deployments") ? deployments : [{ state: "success", environment_url: "javascript:alert(1)", created_at: "2026-09-23" }]);
  assert.equal(unsafe.url, null);
  const mergeSha = "b".repeat(40);
  const mergePreview = await getPreview({ ...key, headSha: sha, mergeSha }, async args => args[0].endsWith("/deployments") ? args.includes(`sha=${mergeSha}`) ? [{ ...deploy(4, "Preview", "2026-09-24"), sha: mergeSha }] : [] : [{ state: "success", environment_url: "https://merge.example.test", created_at: "2026-09-24" }]);
  assert.equal(mergePreview.url, "https://merge.example.test/");
});

test("listing preview resolves the PR head and reuses deployment selection", async () => {
  const calls: string[] = [];
  const result = await getPreviewForPr(key, async args => {
    calls.push(args[0]);
    if (args[0] === "repos/org/repo/pulls/12") return core;
    if (args[0] === "repos/org/repo/deployments") return [{ id: 1, sha, environment: "Preview", created_at: "2026-09-24" }];
    return [{ state: "success", environment_url: "https://preview.example.test", created_at: "2026-09-24" }];
  });
  assert.equal(result.url, "https://preview.example.test/");
  assert.deepEqual(calls, ["repos/org/repo/pulls/12", "repos/org/repo/deployments", "repos/org/repo/deployments/1/statuses"]);
});

test("metadata edits use GitHub's PR and issue endpoints and reject a stale target", async () => {
  const calls: { args: string[]; method: string }[] = [];
  const write: GitHubApi = async (args, method = "GET") => {
    calls.push({ args, method });
    if (method === "GET") return core;
    if (method === "PATCH") return { base: { ref: "release" } };
    if (args[0].includes("/assignees")) return { assignees: [{ login: "alice" }] };
    if (args[0].includes("/requested_reviewers")) return { requested_reviewers: [], requested_teams: [] };
    return method === "POST" ? [{ name: "needs review" }] : [];
  };
  await editPullRequest({ ...key, action: "add-label", name: "needs review" }, write);
  assert.deepEqual(calls.at(-1), { args: ["repos/org/repo/issues/12/labels", "-f", "labels[]=needs review"], method: "POST" });
  await editPullRequest({ ...key, action: "remove-label", name: "needs review" }, write);
  assert.deepEqual(calls.at(-1), { args: ["repos/org/repo/issues/12/labels/needs%20review"], method: "DELETE" });
  await editPullRequest({ ...key, action: "add-assignee", name: "alice" }, write);
  assert.equal(calls.at(-1)?.args[0], "repos/org/repo/issues/12/assignees");
  await editPullRequest({ ...key, action: "remove-reviewer", name: "@org/team" }, write);
  assert.deepEqual(calls.at(-1), { args: ["repos/org/repo/pulls/12/requested_reviewers", "-f", "team_reviewers[]=team"], method: "DELETE" });
  await editPullRequest({ ...key, action: "change-base", base: "release", expectedBase: "main" }, write);
  assert.deepEqual(calls.at(-1), { args: ["repos/org/repo/pulls/12", "-f", "base=release"], method: "PATCH" });
  await assert.rejects(editPullRequest({ ...key, action: "change-base", base: "release", expectedBase: "old" }, write), /changed/);
  await assert.rejects(editPullRequest({ ...key, action: "add-reviewer", name: "@other/team" }, write), /organization/);
  await assert.rejects(editPullRequest({ ...key, action: "add-assignee", name: "bob" }, write), /did not update/);
});

test("edit pickers page repository labels and branches", async () => {
  const labels = await getLabels({ ...key, page: 2 }, async args => { assert.ok(args.includes("page=2")); return [{ name: "bug", color: "d73a4a" }]; });
  const branches = await getBranches({ ...key, page: 1 }, async () => [{ name: "main" }, { name: "release/v2" }]);
  assert.deepEqual(labels.items, [{ name: "bug", color: "d73a4a" }]); assert.equal(labels.hasMore, false);
  assert.deepEqual(branches.items, ["main", "release/v2"]);
});
