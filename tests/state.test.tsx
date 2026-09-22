import assert from "node:assert/strict";
import { test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePullRequests } from "../client/state";
import { defaultFilters, type Filters, type SearchRequest, type Tab } from "../shared/pull-requests";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 25));

test("filter changes reset pagination; tabs retain filters; refresh errors retain data", async () => {
  const client = new QueryClient();
  const calls: SearchRequest[] = [];
  let fail = false;
  const rpc = async (input: SearchRequest) => {
    calls.push(input);
    if (fail) throw new Error("GitHub rate limit reached");
    return { login: "alice", items: [], total: 101, page: input.page, hasMore: input.page === 1, warnings: [] };
  };
  let result!: ReturnType<typeof usePullRequests>;
  function Probe({ filters, tab = "mine" }: { filters: Filters; tab?: Tab }) {
    result = usePullRequests(rpc, tab, filters, true);
    return <>{result.data?.pages.length}{result.error?.message}</>;
  }
  const render = (filters: Filters, tab: Tab = "mine") => <QueryClientProvider client={client}><Probe filters={filters} tab={tab} /></QueryClientProvider>;
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(render(defaultFilters)); });
    await act(tick);
    assert.equal(calls[0].tab, "mine");
    assert.equal(calls[0].filters.relationship, "both");
    await act(async () => { await result.fetchNextPage(); });
    await act(tick);
    assert.equal(result.data?.pages.length, 2);
    const filters = { ...defaultFilters, owner: "acme" };
    await act(async () => { root.update(render(filters)); });
    await act(tick);
    assert.equal(calls.at(-1)?.page, 1);
    assert.equal(result.data?.pages.length, 1);
    await act(async () => { root.update(render(filters, "reviews")); });
    await act(tick);
    assert.equal(calls.at(-1)?.filters.owner, "acme");
    assert.equal(calls.at(-1)?.tab, "reviews");
    fail = true;
    await act(async () => { await result.refetch(); });
    await act(tick);
    assert.equal(result.data?.pages[0].login, "alice");
    assert.match(result.error?.message ?? "", /rate limit/);
  } finally {
    await act(async () => root?.unmount());
    client.clear();
  }
});
