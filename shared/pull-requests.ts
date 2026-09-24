import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { labelSchema } from "./details";

const owner = z.string().trim().max(100).regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9-]*$/);
const repository = z.string().trim().max(201).regex(/^$|^(?:[a-zA-Z0-9][a-zA-Z0-9-]*\/)?[a-zA-Z0-9_.-]+$/);
export const filtersSchema = z.object({
  owner,
  repository,
  status: z.enum(["all", "ready", "draft"]),
  relationship: z.enum(["both", "authored", "assigned"]),
  text: z.string().trim().max(120),
}).superRefine((filters, ctx) => {
  if (filters.repository && !filters.repository.includes("/") && !filters.owner) {
    ctx.addIssue({ code: "custom", message: "Enter owner/repository or choose an owner.", path: ["repository"] });
  }
  if (filters.owner && filters.repository.includes("/") && filters.repository.split("/")[0].toLowerCase() !== filters.owner.toLowerCase()) {
    ctx.addIssue({ code: "custom", message: "Repository must belong to the selected owner.", path: ["repository"] });
  }
});
export type Filters = z.infer<typeof filtersSchema>;
export type Tab = "mine" | "reviews";
export const defaultFilters: Filters = { owner: "", repository: "", status: "all", relationship: "both", text: "" };
export const requestSchema = z.object({
  tab: z.enum(["mine", "reviews"]),
  filters: filtersSchema,
  page: z.number().int().min(1).max(10),
});
export const pullRequestSchema = z.object({
  id: z.number(), number: z.number(), title: z.string(),
  url: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/),
  repository: z.string(), author: z.string(), draft: z.boolean(),
  updatedAt: z.string(), authored: z.boolean(), assigned: z.boolean(), labels: z.array(labelSchema),
});
export const responseSchema = z.object({
  login: z.string(), items: z.array(pullRequestSchema), total: z.number().int().nonnegative(),
  page: z.number().int(), hasMore: z.boolean(), warnings: z.array(z.string()),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type SearchRequest = z.infer<typeof requestSchema>;
export type SearchResponse = z.infer<typeof responseSchema>;
export const pullRequestsRpc = defineRpc({ name: "pull-requests.list", input: requestSchema, output: responseSchema });
