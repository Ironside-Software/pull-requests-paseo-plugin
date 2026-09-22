import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { githubPullRequest, type PaseoWorkspace } from "./integration";

export function registerPrHeaders(client: PluginClientContext) {
  const buttons = new Map<string, PluginButtonRegistration>();
  const pages: Set<string>[] = [];
  const releases: (() => Promise<void>)[] = [];
  let stopped = false;
  function remove(id: string) {
    buttons.get(id)?.remove();
    buttons.delete(id);
  }
  function update(workspace: PaseoWorkspace) {
    if (stopped) return;
    if (workspace.archivingAt || !githubPullRequest(workspace.githubRuntime?.pullRequest?.url)) {
      remove(workspace.id);
      return;
    }
    if (buttons.has(workspace.id)) return;
    buttons.set(workspace.id, client.addHeaderButton({
      id: `open-pr-${workspace.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`,
      workspaceId: workspace.id,
      button: {
        title: "Open PR in Paseo", label: "PR", icon: "GitPullRequest",
        behavior: { kind: "action", onPress: () => client.openPanel("pull-requests", { workspaceId: workspace.id, location: "workspace" }) },
      },
    }));
  }
  const ready = (async () => {
    let cursor: string | undefined;
    do {
      const result = await client.paseo.workspaces.list({ subscribe: {}, page: { limit: 200, cursor } });
      if (stopped) { await result.subscription.release(); return; }
      const ids = new Set<string>();
      pages.push(ids);
      const unsubscribe = result.subscription.subscribe({
        snapshot(snapshot) {
          if (stopped) return;
          const previous = [...ids];
          ids.clear();
          for (const workspace of snapshot.entries) { ids.add(workspace.id); update(workspace); }
          for (const id of previous) if (!pages.some(page => page.has(id))) remove(id);
        },
        update(message) {
          if (stopped || message.type !== "workspace_update") return;
          const change = message.payload;
          if (change.kind === "upsert") { ids.add(change.workspace.id); update(change.workspace); }
          else { ids.delete(change.id); remove(change.id); }
        },
        error() { if (!stopped) console.warn("Pull Requests: workspace header updates unavailable. Reload the plugin to retry."); },
      });
      releases.push(async () => { unsubscribe(); await result.subscription.release(); });
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor && !stopped);
  })().catch(() => {
    if (!stopped) console.warn("Pull Requests: workspace headers could not be loaded. Reload the plugin to retry.");
  });
  return async () => {
    stopped = true;
    for (const id of buttons.keys()) remove(id);
    await Promise.allSettled(releases.map(release => release()));
    await ready;
  };
}
