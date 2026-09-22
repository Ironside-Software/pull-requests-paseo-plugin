import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PullRequestsSurface } from "./client/pull-requests";

export default function contribute(client: PluginClientContext) {
  client.addSurface("pull-requests", PullRequestsSurface);
  client.addSidebarItem({ id: "pull-requests", title: "Pull Requests", icon: "GitPullRequest", surface: "pull-requests" });
  return () => {};
}
