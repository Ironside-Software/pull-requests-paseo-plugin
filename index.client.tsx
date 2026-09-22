import { usePaseo, type PluginClientContext, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { PullRequestsSurface } from "./client/pull-requests";
import { githubRepository } from "./client/integration";

function WorkspacePullRequests(props: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const workspace = useQuery({ queryKey: ["pr-workspace", props.host.id, props.workspaceId], queryFn: () => paseo.workspaces.ref(props.workspaceId).refresh(), retry: false });
  if (workspace.isPending) return <Text style={{ padding: 16, color: props.theme.colors.foregroundMuted }}>Loading workspace…</Text>;
  return <PullRequestsSurface {...props} key={props.workspaceId} initialRepository={githubRepository(workspace.data?.gitRuntime?.remoteUrl) ?? undefined} />;
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSurface("pull-requests", PullRequestsSurface),
    client.addSidebarItem({ id: "pull-requests", title: "Pull Requests", icon: "GitPullRequest", surface: "pull-requests" }),
    client.addWorkspacePanel({ id: "pull-requests", title: "Pull Requests", icon: "GitPullRequest", context: "workspace", locations: ["workspace", "explorer"], Component: WorkspacePullRequests }),
    client.addCommandCenterItem({ id: "pull-requests", title: "Open Pull Requests", icon: "GitPullRequest", context: "global", keywords: ["github", "review", "prs"], onSelect: context => context.openSurface("pull-requests") }),
    client.addCommandCenterItem({ id: "workspace-pull-requests", title: "Workspace Pull Requests", icon: "GitPullRequest", context: "workspace", keywords: ["github", "review", "prs"], onSelect: context => context.openPanel("pull-requests") }),
    client.addSlashCommand({ name: "prs", description: "Open this workspace’s pull requests", argumentHint: "", context: "workspace", onSubmit: context => context.openPanel("pull-requests") }),
  ];
  return () => cleanups.reverse().forEach(cleanup => cleanup());
}
