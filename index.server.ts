import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPullRequests } from "./server/github";
import { pullRequestsRpc } from "./shared/pull-requests";

export default function contribute(server: PluginServerContext) {
  server.handle(pullRequestsRpc, input => listPullRequests(input));
  return () => {};
}
