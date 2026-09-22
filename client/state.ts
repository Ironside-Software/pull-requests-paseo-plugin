import { useInfiniteQuery } from "@tanstack/react-query";
import type { Filters, SearchRequest, SearchResponse, Tab } from "../shared/pull-requests";

export function usePullRequests(rpc: (request: SearchRequest) => Promise<SearchResponse>, tab: Tab, filters: Filters, active: boolean) {
  return useInfiniteQuery({
    queryKey: ["pull-requests", tab, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => rpc({ tab, filters, page: pageParam }),
    getNextPageParam: page => page.hasMore ? page.page + 1 : undefined,
    enabled: active,
    refetchInterval: active ? 60_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
  });
}
