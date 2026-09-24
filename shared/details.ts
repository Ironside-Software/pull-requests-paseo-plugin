import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const repositoryName = z.string().max(201).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/).refine(value => ![".", ".."].includes(value.split("/")[1]));
export const prKeySchema = z.object({ repository: repositoryName, number: z.number().int().positive() });
export type PrKey = z.infer<typeof prKeySchema>;
export const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i);
export const webUrl = z.string().url().refine(value => new URL(value).protocol === "https:");
export const labelSchema = z.object({ name: z.string(), color: z.string().regex(/^[0-9a-fA-F]{6}$/) });
export const mergeMethodSchema = z.enum(["squash", "merge", "rebase"]);
export const detailsSchema = prKeySchema.extend({
  title: z.string(), url: webUrl, body: z.string(), author: z.string(), login: z.string(),
  state: z.enum(["open", "closed", "merged"]), draft: z.boolean(),
  head: z.string(), base: z.string(), headSha: shaSchema, mergeSha: shaSchema.nullable(),
  additions: z.number(), deletions: z.number(), files: z.number(), commits: z.number(),
  updatedAt: z.string(), labels: z.array(labelSchema), assignees: z.array(z.string()), reviewers: z.array(z.string()),
  mergeable: z.boolean().nullable(), mergeState: z.string(), canMerge: z.boolean(), canReview: z.boolean(),
  mergeMethods: z.array(mergeMethodSchema),
});
export type PrDetails = z.infer<typeof detailsSchema>;
export const detailsRpc = defineRpc({ name: "pull-requests.details", input: prKeySchema, output: detailsSchema });
export const previewRpc = defineRpc({ name: "pull-requests.preview", input: prKeySchema.extend({ headSha: shaSchema, mergeSha: shaSchema.nullable() }), output: z.object({ url: webUrl.nullable(), environment: z.string().nullable() }) });
export const previewForPrRpc = defineRpc({ name: "pull-requests.preview-for-pr", input: prKeySchema, output: z.object({ url: webUrl.nullable(), environment: z.string().nullable() }) });
export const labelsRpc = defineRpc({ name: "pull-requests.labels", input: prKeySchema.extend({ page: z.number().int().min(1).max(1000) }), output: z.object({ items: z.array(labelSchema), page: z.number(), hasMore: z.boolean() }) });
export const branchesRpc = defineRpc({ name: "pull-requests.branches", input: prKeySchema.extend({ page: z.number().int().min(1).max(1000) }), output: z.object({ items: z.array(z.string()), page: z.number(), hasMore: z.boolean() }) });
const name = z.string().trim().min(1).max(100);
export const editSchema = z.discriminatedUnion("action", [
  prKeySchema.extend({ action: z.enum(["add-label", "remove-label"]), name }),
  prKeySchema.extend({ action: z.enum(["add-assignee", "remove-assignee"]), name: name.regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/) }),
  prKeySchema.extend({ action: z.enum(["add-reviewer", "remove-reviewer"]), name: name.regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9-]*|@[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9-]*)$/) }),
  prKeySchema.extend({ action: z.literal("change-base"), base: z.string().trim().min(1).max(255), expectedBase: z.string().min(1) }),
]);
export type PrEdit = z.infer<typeof editSchema>;
export const editRpc = defineRpc({ name: "pull-requests.edit", input: editSchema, output: z.object({ message: z.string() }) });
const pageInput = prKeySchema.extend({ page: z.number().int().min(1).max(1000) });
export const fileSchema = z.object({ path: z.string(), previousPath: z.string().nullable(), status: z.string(), additions: z.number(), deletions: z.number(), patch: z.string().nullable(), url: webUrl });
export const filesRpc = defineRpc({ name: "pull-requests.files", input: pageInput.extend({ page: z.number().int().min(1).max(30) }), output: z.object({ items: z.array(fileSchema), page: z.number(), hasMore: z.boolean(), warning: z.string().nullable() }) });
export const activitySchema = z.object({ id: z.string(), kind: z.enum(["comment", "review", "inline"]), author: z.string(), body: z.string(), state: z.string().nullable(), path: z.string().nullable(), commentId: z.number().nullable(), replyTo: z.number().nullable(), line: z.number().nullable(), diffHunk: z.string().nullable(), date: z.string(), url: webUrl });
export const activityRpc = defineRpc({ name: "pull-requests.activity", input: pageInput, output: z.object({ items: z.array(activitySchema), page: z.number(), hasMore: z.boolean() }) });
export const checksRpc = defineRpc({ name: "pull-requests.checks", input: prKeySchema.extend({ headSha: shaSchema, page: z.number().int().min(1).max(1000) }), output: z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), url: webUrl.nullable() })), page: z.number(), hasMore: z.boolean(), warnings: z.array(z.string()) }) });
const body = z.string().trim().min(1, "Write a comment before submitting.").max(65536);
export const actionSchema = z.discriminatedUnion("action", [
  prKeySchema.extend({ action: z.literal("comment"), body }),
  prKeySchema.extend({ action: z.literal("inline-comment"), body, headSha: shaSchema, path: z.string().min(1).max(4096).refine(path => !path.includes("\0")), line: z.number().int().positive(), side: z.enum(["LEFT", "RIGHT"]) }),
  prKeySchema.extend({ action: z.literal("reply"), body, replyTo: z.number().int().positive() }),
  prKeySchema.extend({ action: z.literal("approve"), body: z.string().trim().max(65536), headSha: shaSchema }),
  prKeySchema.extend({ action: z.literal("request-changes"), body, headSha: shaSchema }),
  prKeySchema.extend({ action: z.literal("merge"), method: mergeMethodSchema, headSha: shaSchema }),
]);
export type PrAction = z.infer<typeof actionSchema>;
export const actionRpc = defineRpc({ name: "pull-requests.action", input: actionSchema, output: z.object({ message: z.string() }) });

export type PrActivity = z.infer<typeof activitySchema>;
export const commitsRpc = defineRpc({ name: "pull-requests.commits", input: pageInput.extend({ page: z.number().int().min(1).max(3) }), output: z.object({ items: z.array(z.object({ sha: shaSchema, message: z.string(), author: z.string(), date: z.string(), url: webUrl })), page: z.number(), hasMore: z.boolean(), warning: z.string().nullable() }) });
