import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { requestSchema, responseSchema, type SearchRequest, type SearchResponse } from "../shared/pull-requests";

const exec = promisify(execFile);
const userSchema = z.object({ login: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/) });
const githubSearchSchema = z.object({
  total_count: z.number().int().nonnegative(), incomplete_results: z.boolean(),
  items: z.array(z.object({
    id: z.number(), number: z.number(), title: z.string(), html_url: z.string(),
    repository_url: z.string().regex(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/),
    user: z.object({ login: z.string() }).nullable(),
    assignees: z.array(z.object({ login: z.string() })),
    draft: z.boolean().optional(), updated_at: z.string(), pull_request: z.object({}).passthrough(),
  })),
});

export function buildQuery({ tab, filters }: SearchRequest, login: string): string {
  const relationship = tab === "reviews" ? `review-requested:${login}`
    : filters.relationship === "authored" ? `author:${login}`
    : filters.relationship === "assigned" ? `assignee:${login}`
    : `(author:${login} OR assignee:${login})`;
  const terms = ["is:pr", "is:open", relationship];
  if (filters.owner) terms.push(`user:${filters.owner}`);
  if (filters.repository) terms.push(`repo:${filters.repository.includes("/") ? filters.repository : `${filters.owner}/${filters.repository}`}`);
  if (filters.status !== "all") terms.push(`draft:${filters.status === "draft"}`);
  // Treat search as literal title text, never as user-supplied GitHub qualifiers.
  const title = filters.text.replace(/["\\\x00-\x1f]/g, " ").trim();
  if (title) terms.push(`"${title}" in:title`);
  return terms.join(" ");
}

export function githubError(error: unknown): Error {
  const failure = error as { code?: string; killed?: boolean; stderr?: string };
  const stderr = typeof failure?.stderr === "string" ? failure.stderr.toLowerCase() : "";
  if (failure?.code === "ENOENT") return new Error("Install GitHub CLI (gh) on the Paseo daemon host, then sign in with gh auth login.");
  if (failure?.killed) return new Error("GitHub took too long to respond. Try Refresh again.");
  if (/rate limit|secondary rate|abuse/.test(stderr)) return new Error("GitHub rate limit reached. Wait a few minutes before refreshing.");
  if (/auth login|not logged|authentication|bad credentials|http 401/.test(stderr)) return new Error("GitHub login is missing or expired. Run gh auth login on the Paseo daemon host.");
  if (/saml|sso|http 403/.test(stderr)) return new Error("GitHub access was denied. Check the daemon account's repository permissions and organization SSO authorization.");
  if (/http 409|http 405/.test(stderr)) return new Error("GitHub refused the merge. Refresh the PR and check conflicts, required reviews, and branch protection.");
  if (/http 404/.test(stderr)) return new Error("GitHub could not find this PR or repository. Check your account access and refresh.");
  if (/http 422|validation failed/.test(stderr)) return new Error("GitHub rejected the request. Check the filters, PR state, and your account permissions.");
  return new Error("Could not load pull requests from GitHub. Check the daemon's network connection and GitHub access, then refresh.");
}

export async function runGh(args: string[], method: "GET" | "POST" | "PUT" = "GET"): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await exec("gh", ["api", "--hostname", "github.com", "--method", method, ...args], {
      timeout: 20_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", windowsHide: true,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    }));
  } catch (error) { throw githubError(error); }
  try { return JSON.parse(stdout); }
  catch { throw new Error("GitHub returned an unreadable response. Try Refresh again."); }
}

export async function listPullRequests(input: SearchRequest, api = runGh): Promise<SearchResponse> {
  const request = requestSchema.parse(input);
  const { login } = userSchema.parse(await api(["user"]));
  const result = githubSearchSchema.safeParse(await api([
    "search/issues", "-f", `q=${buildQuery(request, login)}`, "-f", "advanced_search=true",
    "-f", "sort=updated", "-f", "order=desc", "-f", "per_page=100", "-f", `page=${request.page}`,
  ]));
  if (!result.success) throw new Error("GitHub returned an unexpected pull request response. Try Refresh again.");
  const data = result.data;
  const warnings: string[] = [];
  if (data.incomplete_results) warnings.push("GitHub returned incomplete results. Refresh or narrow your filters.");
  // ponytail: GitHub search exposes 1,000 results; narrow filters instead of partitioning searches.
  if (data.total_count > 1000) warnings.push("GitHub exposes only the first 1,000 matching PRs. Narrow your filters to see the rest.");
  const items = [...new Map(data.items.map(pr => [pr.id, {
    id: pr.id, number: pr.number, title: pr.title, url: pr.html_url,
    repository: pr.repository_url.slice("https://api.github.com/repos/".length),
    author: pr.user?.login ?? "Deleted user", draft: pr.draft ?? false, updatedAt: pr.updated_at,
    authored: pr.user?.login.toLowerCase() === login.toLowerCase(),
    assigned: pr.assignees.some(user => user.login.toLowerCase() === login.toLowerCase()),
  }])).values()];
  return responseSchema.parse({ login, items, total: data.total_count, page: request.page,
    hasMore: request.page * 100 < Math.min(data.total_count, 1000) && data.items.length > 0, warnings });
}
