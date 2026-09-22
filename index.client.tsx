import { usePaseo, type PluginClientContext, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Control } from "./client/control";
import { Text, View } from "react-native";
import { PullRequestsSurface } from "./client/pull-requests";
import { registerPrHeaders } from "./client/header";
import { githubRepository, githubPullRequest } from "./client/integration";

export function WorkspacePullRequests(props: PluginWorkspacePanelProps) {
  return <WorkspaceContext key={`${props.host.id}:${props.workspaceId}`} {...props} />;
}
function WorkspaceContext(props: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const workspace = useQuery({ queryKey: ["pr-workspace", props.host.id, props.workspaceId], queryFn: () => paseo.workspaces.ref(props.workspaceId).refresh(), retry: false });
  const opened = useRef(false);
  const [all, setAll] = useState(false);
  const c = props.theme.colors;
  const repository = githubRepository(workspace.data?.gitRuntime?.remoteUrl);
  const linkedPr = githubPullRequest(workspace.data?.githubRuntime?.pullRequest?.url);
  if (!workspace.data && workspace.isPending) return <Text style={{ padding: 16, color: c.foregroundMuted }}>Loading workspace…</Text>;
  if (!workspace.data && workspace.error) return <View style={{ padding: 16, gap: 12 }}>
    <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>Workspace could not be loaded.</Text>
    <Control theme={props.theme} compact={props.layout.compact} label="Retry" onPress={() => void workspace.refetch()} disabled={workspace.isFetching} />
  </View>;
  if (!repository && !linkedPr && !all && !opened.current) return <View style={{ padding: 16, gap: 12 }}>
    <Text style={{ color: c.foregroundMuted }}>This workspace has no supported GitHub repository.</Text>
    <Control theme={props.theme} compact={props.layout.compact} label="Open all PRs" onPress={() => setAll(true)} />
  </View>;
  opened.current = true;
  return <View style={{ flex: 1 }}>
    {!linkedPr && repository && <Text style={{ padding: 12, color: c.foregroundMuted }}>
      {workspace.data?.githubRuntime?.error
        ? "Paseo could not check this workspace’s PR. Showing your repository PRs below; refresh to retry."
        : `No linked PR for ${workspace.data?.gitRuntime?.currentBranch || "this workspace"}. Showing your repository PRs below.`}
    </Text>}
    {workspace.error && <Text accessibilityRole="alert" style={{ padding: 12, color: c.statusDanger }}>Workspace refresh failed. Showing previous context; refresh to retry.</Text>}
    <PullRequestsSurface {...props} key={`${props.host.id}:${props.workspaceId}`} workspaceId={props.workspaceId}
      initialPr={linkedPr ?? undefined} initialRepository={linkedPr?.repository ?? repository ?? undefined}
      onRefreshContext={() => void workspace.refetch()} />
  </View>;
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSurface("pull-requests", PullRequestsSurface),
    client.addSidebarItem({ id: "pull-requests", title: "Pull Requests", icon: "GitPullRequest", surface: "pull-requests" }),
    client.addWorkspacePanel({ id: "pull-requests", title: "Pull Requests", icon: "GitPullRequest", context: "workspace", locations: ["workspace", "explorer"], Component: WorkspacePullRequests }),
    client.addCommandCenterItem({ id: "pull-requests", title: "Open Pull Requests", icon: "GitPullRequest", context: "global", keywords: ["github", "review", "prs"], onSelect: context => context.openSurface("pull-requests") }),
    client.addCommandCenterItem({ id: "workspace-pull-requests", title: "Workspace Pull Requests", icon: "GitPullRequest", context: "workspace", keywords: ["github", "review", "prs"], onSelect: context => context.openPanel("pull-requests") }),
  ];
  const stopHeaders = registerPrHeaders(client);
  return async () => { cleanups.reverse().forEach(cleanup => cleanup()); await stopHeaders(); };
}
