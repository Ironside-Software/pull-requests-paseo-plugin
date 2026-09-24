import type { PrActivity } from "../shared/details";

export function safeLink(href: string, baseUrl: string) {
  try { const url = new URL(href, baseUrl); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
export type DiffLine = { kind: "hunk" | "added" | "removed" | "context" | "note"; text: string; oldLine: number | null; newLine: number | null };
export function parseDiff(patch: string): DiffLine[] {
  let oldLine = 0, newLine = 0, inHunk = false;
  return patch.split("\n").map(line => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; return { kind: "hunk", text: line, oldLine: null, newLine: null }; }
    if (!inHunk || line.startsWith("\\") || line === "") return { kind: "note", text: line, oldLine: null, newLine: null };
    if (line[0] === "+") return { kind: "added", text: line.slice(1), oldLine: null, newLine: newLine++ };
    if (line[0] === "-") return { kind: "removed", text: line.slice(1), oldLine: oldLine++, newLine: null };
    return { kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ };
  });
}
export type SplitDiffRow = { left: number | null; right: number | null; header: number | null };
export function splitDiff(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === "added" || lines[i].kind === "removed") {
      const removed: number[] = [], added: number[] = [];
      while (i < lines.length && (lines[i].kind === "added" || lines[i].kind === "removed")) {
        (lines[i].kind === "removed" ? removed : added).push(i++);
      }
      for (let j = 0; j < Math.max(removed.length, added.length); j++) rows.push({ left: removed[j] ?? null, right: added[j] ?? null, header: null });
    } else if (lines[i].kind === "context") rows.push({ left: i, right: i++, header: null });
    else rows.push({ left: null, right: null, header: i++ });
  }
  return rows;
}
export function reviewSummary(items: PrActivity[]) {
  const latest = new Map<string, PrActivity>();
  for (const item of [...items].sort((a,b) => a.date.localeCompare(b.date))) {
    if (item.kind === "review" && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(item.state ?? "")) latest.set(item.author, item);
  }
  return [...latest.values()];
}
export function checkState(status: string): "pass" | "fail" | "pending" | "neutral" {
  if (["success", "neutral", "skipped"].includes(status)) return "pass";
  if (["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure"].includes(status)) return "fail";
  if (["pending", "queued", "in_progress", "waiting", "requested"].includes(status)) return "pending";
  return "neutral";
}
export function mergeExplanation(state: string, draft: boolean, mergeable: boolean | null) {
  if (draft) return "This PR is a draft. Mark it ready on GitHub before merging.";
  if (mergeable === false || state === "dirty") return "This branch has conflicts that must be resolved before merging.";
  if (state === "blocked") return "GitHub is blocking the merge. Required reviews or branch rules still need attention.";
  if (state === "behind") return "This branch is behind the base branch. Update it on GitHub or in your workspace.";
  if (state === "unstable") return "Some checks have not passed. Review the checks before merging.";
  if (state === "clean") return "GitHub reports this branch can be merged.";
  return "GitHub is checking mergeability. Refresh for the latest result.";
}
