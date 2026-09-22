import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiff, reviewSummary, checkState, safeLink, mergeExplanation } from "../client/review-state";
import { marked } from "marked";
import type { PrActivity } from "../shared/details";

test("diff line numbers respect context, deletions, additions and multiple hunks", () => {
  const lines = parseDiff("@@ -5,3 +5,3 @@\n context\n-old\n+new\n last\n@@ -20,0 +21,2 @@\n+first\n+second\n\\ No newline at end of file");
  assert.deepEqual(lines.map(l => [l.kind, l.oldLine, l.newLine]), [["hunk",null,null],["context",5,5],["removed",6,null],["added",null,6],["context",7,7],["hunk",null,null],["added",null,21],["added",null,22],["note",null,null]]);
  assert.equal(lines[3].text, "new");
});
test("review summaries retain the last decision rather than treating comments as approval", () => {
  const review = (state: string, date: string) => ({ id: date, kind: "review", author: "reviewer", state, date }) as PrActivity;
  const items = [review("APPROVED", "2026-09-20"), review("COMMENTED", "2026-09-21"), review("CHANGES_REQUESTED", "2026-09-22")];
  assert.equal(reviewSummary(items)[0].state, "CHANGES_REQUESTED");
  assert.equal(reviewSummary(items.slice(0,2))[0].state, "APPROVED");
  assert.equal(checkState("failure"), "fail"); assert.equal(checkState("in_progress"), "pending"); assert.equal(checkState("skipped"), "pass"); assert.equal(checkState("unknown"), "neutral");
  assert.match(mergeExplanation("dirty", false, false), /conflicts/);
});
test("Markdown preserves structure while links reject executable and credential URLs", () => {
  const tokens = marked.lexer("## Summary\n\n- **Fix** this\n- [x] Tested\n\n```ts\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
  assert.ok(tokens.some(t => t.type === "heading")); assert.ok(tokens.some(t => t.type === "list")); assert.ok(tokens.some(t => t.type === "code")); assert.ok(tokens.some(t => t.type === "table"));
  const base = "https://github.com/org/repo/pull/1";
  assert.equal(safeLink("javascript:alert(1)", base), null);
  assert.equal(safeLink("data:text/html,test", base), null);
  assert.equal(safeLink("https://name:password@example.org", base), null);
  assert.equal(safeLink("#discussion", base), base + "#discussion");
});
