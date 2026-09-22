import assert from "node:assert/strict";
import { test } from "node:test";
import { githubPullRequest, githubRepository, selectWorkspace } from "../client/integration";

test("linked PR URLs resolve only supported, validated GitHub targets", () => {
  assert.deepEqual(githubPullRequest("https://github.com/Acme/Widget/pull/42/?tab=files#diff"), { repository: "acme/widget", number: 42 });
  for (const value of [null, "", "invalid", "http://github.com/a/b/pull/1", "https://github.com.evil/a/b/pull/1", "https://user@github.com/a/b/pull/1", "https://github.com:444/a/b/pull/1", "https://github.com/a/b/issues/1", "https://github.com/a/b/pull/0", "https://github.com/a/b/pull/1/files", "https://github.com/a/b/pull/9007199254740992"]) {
    assert.equal(githubPullRequest(value), null, String(value));
  }
  assert.equal(githubRepository("git@github.com:Acme/Widget.git"), "acme/widget");
});

test("workspace selection prefers explicit choice, then current, then sole match", () => {
  const a = { id: "a" }, b = { id: "b" };
  assert.equal(selectWorkspace([], "a"), undefined);
  assert.equal(selectWorkspace([a]), a);
  assert.equal(selectWorkspace([a, b]), undefined);
  assert.equal(selectWorkspace([a, b], "b"), b);
  assert.equal(selectWorkspace([a, b], "b", "a"), a);
  assert.equal(selectWorkspace([a, b], "missing", "stale"), undefined);
});
