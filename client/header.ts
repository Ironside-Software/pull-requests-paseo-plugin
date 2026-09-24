import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { Linking } from "react-native";
import { detailsRpc, previewRpc } from "../shared/details";
import { githubPullRequest, type PaseoWorkspace } from "./integration";

export function registerPrHeaders(client: PluginClientContext) {
  const buttons = new Map<string, PluginButtonRegistration>();
  const previews = new Map<string, PluginButtonRegistration>();
  const lastPreviewCheck = new Map<string, { key: string; time: number }>();
  const pages: Set<string>[] = [];
  const releases: (() => Promise<void>)[] = [];
  let stopped = false;
  function remove(id: string) {
    buttons.get(id)?.remove();
    buttons.delete(id);
    previews.get(id)?.remove();
    previews.delete(id);
    lastPreviewCheck.delete(id);
  }
  async function refreshPreview(workspaceId: string, key: NonNullable<ReturnType<typeof githubPullRequest>>, check: { key: string; time: number }) {
    try {
      const details = await client.rpc(detailsRpc, key);
      const preview = await client.rpc(previewRpc, { ...key, headSha: details.headSha, mergeSha: details.mergeSha });
      if (stopped || !buttons.has(workspaceId) || lastPreviewCheck.get(workspaceId) !== check) return;
      if (!preview.url) { previews.get(workspaceId)?.remove(); previews.delete(workspaceId); return; }
      const button = { title: `Open ${preview.environment ?? "preview"} deployment`, label: "Preview", icon: "ExternalLink", behavior: { kind: "action" as const, onPress: () => Linking.openURL(preview.url!) } };
      if (previews.has(workspaceId)) previews.get(workspaceId)!.update(button);
      else previews.set(workspaceId, client.addHeaderButton({ id: `preview-pr-${workspaceId.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`, workspaceId, button }));
    } catch { /* A missing deployment or GitHub access must not hide the PR button. */ }
  }
  function update(workspace: PaseoWorkspace) {
    if (stopped) return;
    const key = githubPullRequest(workspace.githubRuntime?.pullRequest?.url);
    if (workspace.archivingAt || !key) {
      remove(workspace.id);
      return;
    }
    if (!buttons.has(workspace.id)) buttons.set(workspace.id, client.addHeaderButton({
      id: `open-pr-${workspace.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`,
      workspaceId: workspace.id,
      button: { title: "Open PR in Paseo", label: "PR", icon: "GitPullRequest", behavior: { kind: "action", onPress: () => client.openPanel("pull-requests", { workspaceId: workspace.id, location: "workspace" }) } },
    }));
    const current = `${key.repository}#${key.number}`;
    const checked = lastPreviewCheck.get(workspace.id);
    if (checked?.key !== current) { previews.get(workspace.id)?.remove(); previews.delete(workspace.id); }
    if (checked?.key === current && Date.now() - checked.time < 60_000) return;
    const check = { key: current, time: Date.now() };
    lastPreviewCheck.set(workspace.id, check);
    void refreshPreview(workspace.id, key, check);
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
