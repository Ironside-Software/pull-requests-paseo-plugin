import type { usePaseo } from "@getpaseo/plugin/client";
import { prKeySchema, type PrDetails } from "../shared/details";

type PaseoApi = ReturnType<typeof usePaseo>;
export type PaseoWorkspace = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"][number];

export function githubRepository(remote: string | null | undefined) {
  const match = remote?.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)\/?$/i);
  return match?.[1].replace(/\.git$/i, "").toLowerCase() ?? null;
}
export function githubPullRequest(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)\/?$/);
    if (!match) return null;
    const result = prKeySchema.safeParse({ repository: match[1].toLowerCase(), number: Number(match[2]) });
    return result.success && Number.isSafeInteger(result.data.number) ? result.data : null;
  } catch { return null; }
}

export function selectWorkspace<T extends { id: string }>(matches: T[], currentId?: string, selectedId?: string) {
  return matches.find(workspace => workspace.id === selectedId)
    ?? matches.find(workspace => workspace.id === currentId)
    ?? (matches.length === 1 ? matches[0] : undefined);
}

export async function listWorkspaces(paseo: PaseoApi) {
  const result: PaseoWorkspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: 100, cursor } });
    result.push(...page.entries.filter(workspace => !workspace.archivingAt));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return result;
}
export function matchingWorkspaces(workspaces: PaseoWorkspace[], pr: Pick<PrDetails, "repository" | "number">) {
  return workspaces.filter(workspace => {
    const linked = githubPullRequest(workspace.githubRuntime?.pullRequest?.url);
    return linked?.repository === pr.repository.toLowerCase() && linked.number === pr.number;
  });
}
export function matchingProjects(workspaces: PaseoWorkspace[], repository: string) {
  return [...new Map(workspaces.filter(w => githubRepository(w.gitRuntime?.remoteUrl) === repository.toLowerCase()).map(w => [w.projectId, w])).values()];
}
export async function createReviewWorkspace(paseo: PaseoApi, pr: PrDetails, projectId: string) {
  return paseo.workspaces.create({ title: `${pr.repository.split("/")[1]} #${pr.number}`, source: { kind: "worktree", projectId, action: "checkout", checkoutSource: { kind: "change_request", forge: "github", number: pr.number, projectPath: pr.repository } } });
}
