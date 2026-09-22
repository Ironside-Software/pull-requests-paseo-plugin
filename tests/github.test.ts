import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuery, githubError, listPullRequests } from "../server/github";
import { defaultFilters, requestSchema, type SearchRequest } from "../shared/pull-requests";

const request: SearchRequest = { tab: "mine", filters: { ...defaultFilters }, page: 1 };
const pr = {
  id: 42, number: 7, title: "Fix dashboard", html_url: "https://github.com/acme/app/pull/7",
  repository_url: "https://api.github.com/repos/acme/app", user: { login: "Alice" },
  assignees: [{ login: "alice" }], draft: true, updated_at: "2026-09-22T10:00:00Z", pull_request: {},
};

test("queries combine authored OR assigned; review tab includes direct and team requests", () => {
  assert.equal(buildQuery(request, "alice"), "is:pr is:open (author:alice OR assignee:alice)");
  assert.match(buildQuery({ ...request, filters: { ...defaultFilters, relationship: "authored" } }, "alice"), /author:alice$/);
  assert.match(buildQuery({ ...request, filters: { ...defaultFilters, relationship: "assigned" } }, "alice"), /assignee:alice$/);
  assert.equal(buildQuery({ ...request, tab: "reviews", filters: { ...defaultFilters, relationship: "assigned" } }, "alice"), "is:pr is:open review-requested:alice");
});

test("all filters apply to the GitHub query, including literal title search", () => {
  const filters = { ...defaultFilters, owner: "acme", repository: "app", status: "ready" as const, text: 'fix " OR is:closed' };
  assert.equal(buildQuery({ ...request, filters }, "alice"), 'is:pr is:open (author:alice OR assignee:alice) user:acme repo:acme/app draft:false "fix   OR is:closed" in:title');
  assert.match(buildQuery({ ...request, filters: { ...filters, repository: "acme/app", status: "draft" } }, "alice"), /repo:acme\/app draft:true/);
});

test("RPC rejects query injection, invalid pages, and conflicting owners", () => {
  for (const filters of [
    { ...defaultFilters, owner: "acme OR is:closed" },
    { ...defaultFilters, repository: "app" },
    { ...defaultFilters, owner: "acme", repository: "other/app" },
  ]) assert.equal(requestSchema.safeParse({ ...request, filters }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, page: 11 }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, page: 0 }).success, false);
});

test("normalization deduplicates and preserves both relationship badges", async () => {
  const calls: string[][] = [];
  const result = await listPullRequests(request, async args => {
    calls.push(args);
    return args[0] === "user" ? { login: "alice" } : { total_count: 101, incomplete_results: false, items: [pr, pr] };
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].authored, true);
  assert.equal(result.items[0].assigned, true);
  assert.equal(result.items[0].draft, true);
  assert.equal(result.items[0].repository, "acme/app");
  assert.equal(result.hasMore, true);
  assert.ok(calls[1].includes("advanced_search=true"));
  assert.ok(calls[1].includes("per_page=100"));
});

test("pagination and incomplete search results are explicit", async () => {
  const result = await listPullRequests({ ...request, page: 10 }, async args => args[0] === "user" ? { login: "alice" } : {
    total_count: 1200, incomplete_results: true, items: [{ ...pr, user: null, assignees: [], draft: undefined }],
  });
  assert.equal(result.page, 10);
  assert.equal(result.hasMore, false);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.items[0].author, "Deleted user");
  assert.equal(result.items[0].authored, false);
});

test("unexpected responses and unsafe links are rejected", async () => {
  await assert.rejects(listPullRequests(request, async args => args[0] === "user" ? { login: "alice" } : {}), /unexpected/);
  await assert.rejects(listPullRequests(request, async args => args[0] === "user" ? { login: "alice" } : {
    total_count: 1, incomplete_results: false, items: [{ ...pr, html_url: "javascript:alert(1)" }],
  }));
});

test("actionable errors never expose process stderr or credentials", () => {
  for (const [failure, expected] of [
    [{ code: "ENOENT" }, /Install GitHub CLI/],
    [{ killed: true }, /too long/],
    [{ stderr: "HTTP 401 bad credentials SECRET" }, /gh auth login/],
    [{ stderr: "HTTP 403 rate limit exceeded SECRET" }, /rate limit/],
    [{ stderr: "HTTP 403 SAML SECRET" }, /SSO/],
    [{ stderr: "HTTP 422 validation failed SECRET" }, /filters/],
    [{ stderr: "network SECRET" }, /network/],
  ] as const) {
    const message = githubError(failure).message;
    assert.match(message, expected);
    assert.doesNotMatch(message, /SECRET/);
  }
});
