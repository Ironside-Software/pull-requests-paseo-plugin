import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPullRequests } from "./server/github";
import { pullRequestsRpc } from "./shared/pull-requests";

import { detailsRpc, filesRpc, activityRpc, checksRpc, commitsRpc, actionRpc, previewRpc, previewForPrRpc, labelsRpc, branchesRpc, editRpc } from "./shared/details";
import { getDetails, getFiles, getActivity, getChecks, getCommits, performAction, getPreview, getPreviewForPr, getLabels, getBranches, editPullRequest } from "./server/details";

export default function contribute(server: PluginServerContext) {
  server.handle(pullRequestsRpc, input => listPullRequests(input));
  server.handle(detailsRpc, input => getDetails(input));
  server.handle(filesRpc, input => getFiles(input));
  server.handle(activityRpc, input => getActivity(input));
  server.handle(checksRpc, input => getChecks(input));
  server.handle(commitsRpc, input => getCommits(input));
  server.handle(actionRpc, input => performAction(input));
  server.handle(previewRpc, input => getPreview(input));
  server.handle(previewForPrRpc, input => getPreviewForPr(input));
  server.handle(labelsRpc, input => getLabels(input));
  server.handle(branchesRpc, input => getBranches(input));
  server.handle(editRpc, input => editPullRequest(input));
  return () => {};
}
