import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { PullRequestDetails } from "./details";
import type { PrKey } from "../shared/details";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { defaultFilters, filtersSchema, pullRequestsRpc, type Filters, type Tab } from "../shared/pull-requests";
import { Control } from "./control";
import { usePullRequests } from "./state";
import { useQuery } from "@tanstack/react-query";
import { listWorkspaces } from "./integration";
import { PrWorkspaceActions } from "./workspace-launcher";

export function PullRequestsSurface(props: PluginSurfaceProps & { initialRepository?: string; initialPr?: PrKey; workspaceId?: string; onRefreshContext?(): void }) {
  const { theme, layout } = props;
  const [selectedPr, setSelectedPr] = useState<PrKey | null>(props.initialPr ?? null);
  const workspacePrHandled = useRef(!!props.initialPr);
  useEffect(() => {
    if (!workspacePrHandled.current && props.initialPr) {
      workspacePrHandled.current = true;
      setSelectedPr(current => current ?? props.initialPr!);
    }
  }, [props.initialPr]);

  const initialFilters = { ...defaultFilters, repository: props.initialRepository ?? "" };
  const rpc = useRpc(pullRequestsRpc);
  const [tab, setTab] = useState<Tab>("mine");
  const [hoveredPr, setHoveredPr] = useState<number | null>(null);
  const [focusedPr, setFocusedPr] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [validation, setValidation] = useState("");
  useEffect(() => {
    const repository = props.initialRepository ?? "";
    setFilters(current => ({ ...current, repository, owner: "" }));
    setDraft(current => ({ ...current, repository, owner: "" }));
  }, [props.initialRepository]);
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  const query = usePullRequests(rpc, tab, filters, active && !selectedPr, props.host.id);
  const paseo = usePaseo();
  const workspaces = useQuery({ queryKey: ["pr-workspaces", props.host.id], queryFn: () => listWorkspaces(paseo), enabled: active && !selectedPr && !!props.navigation, staleTime: 60_000, retry: false });
  const firstPage = query.data?.pages[0];
  const items = [...new Map(query.data?.pages.flatMap(page => page.items).map(pr => [pr.id, pr]) ?? []).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  const warnings = [...new Set(query.data?.pages.flatMap(page => page.warnings) ?? [])];
  const owners = [...new Set(items.map(pr => pr.repository.split("/")[0]))].sort();
  const repositories = [...new Set(items.map(pr => pr.repository))]
    .filter(repo => !draft.owner || repo.split("/")[0].toLowerCase() === draft.owner.toLowerCase()).sort();
  const c = theme.colors;
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.surface0 },
    content: { padding: layout.compact ? 12 : 20, gap: 10, width: "100%", maxWidth: 1200, alignSelf: "center" },
    subtitle: { fontSize: 12, lineHeight: 18, color: c.foregroundMuted },
    row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
    panel: { backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: 8, padding: 12, gap: 10 },
    field: { flexGrow: 1, flexBasis: layout.compact ? "100%" : 260, gap: 6 },
    label: { color: c.foreground, fontSize: 13, fontWeight: "600" },
    input: { minHeight: layout.compact ? 40 : 34, borderWidth: 1, borderColor: c.border, borderRadius: 5, padding: 8, backgroundColor: c.surface0, color: c.foreground, fontSize: 14 },
    card: { paddingVertical: 10, borderBottomWidth: 1, borderColor: c.border, gap: 4 },
    prTitle: { color: c.foreground, fontSize: 14, fontWeight: "600", lineHeight: 20 },
    badge: { color: c.foregroundMuted, backgroundColor: c.surface2, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 11 },
    error: { color: c.statusDanger, fontSize: 14, lineHeight: 21 },
    warning: { color: c.statusWarning, fontSize: 14, lineHeight: 21 },
  }), [c, layout.compact]);

  function button(label: string, onPress: () => void, selected = false, disabled = false, role: "button" | "tab" | "radio" = "button") {
    return <Control key={label} theme={theme} compact={layout.compact} label={label} onPress={onPress} selected={selected} disabled={disabled} role={role} />;
  }
  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraft(current => ({ ...current, [key]: value, ...(key === "owner" ? { repository: "" } : {}) }));
    setValidation("");
  }
  function apply() {
    const result = filtersSchema.safeParse(draft);
    if (!result.success) { setValidation(result.error.issues[0].message); return; }
    setFilters(result.data);
    setDraft(result.data);
    setValidation("");
  }
  function clear() { const cleared = { ...defaultFilters, repository: props.initialRepository ?? "" }; setDraft(cleared); setFilters(cleared); setValidation(""); }
  const pending = JSON.stringify(draft) !== JSON.stringify(filters);
  const filtered = Object.entries(filters).some(([key, value]) => value !== (key === "repository" ? props.initialRepository ?? "" : defaultFilters[key as keyof Filters]) && (tab === "mine" || key !== "relationship"));

  return <>
    {selectedPr && <PullRequestDetails {...props} key={`${selectedPr.repository}#${selectedPr.number}`} pr={selectedPr} active={active} workspaceId={props.workspaceId} backLabel={props.initialRepository ? "Repository PRs" : "PRs"} onRefreshContext={props.onRefreshContext} onBack={() => { workspacePrHandled.current = true; setSelectedPr(null); void query.refetch(); }} />}
    <ScrollView style={[styles.screen, !!selectedPr && { display: "none" }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {props.initialPr && <View style={styles.row}>
      <Control theme={theme} compact={layout.compact} label="Open workspace PR" icon="GitPullRequest" onPress={() => setSelectedPr(props.initialPr!)} />
      <Text style={styles.subtitle}>{props.initialPr.repository} #{props.initialPr.number}</Text>
    </View>}
    <View style={[styles.row, { borderBottomWidth: 1, borderColor: c.border, gap: 4 }]}>
      <View style={[styles.row, { gap: 4, ...(layout.compact ? { flexBasis: "100%" } : {}) }]}>
        {button("My PRs", () => setTab("mine"), tab === "mine", false, "tab")}
        {button("Awaiting my review", () => setTab("reviews"), tab === "reviews", false, "tab")}
      </View>
      {!layout.compact && <View style={{ flex: 1 }} />}
      <Control theme={theme} compact={layout.compact} label={filtered ? "Filters · Active" : "Filters"} icon="ListFilter" expanded={filtersOpen} onPress={() => setFiltersOpen(open => !open)} />
      <Control theme={theme} compact={layout.compact} label={query.isFetching && !query.isFetchingNextPage ? "Refreshing…" : "Refresh"} icon="RefreshCw" onPress={() => { props.onRefreshContext?.(); void query.refetch(); void workspaces.refetch(); }} disabled={query.isFetching} />
      {filtered && button("Clear filters", clear)}
    </View>
    {filtersOpen && <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.label}>Filters</Text>
      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={styles.label}>Organization or owner</Text>
          <TextInput accessibilityLabel="Organization or owner" placeholder="All owners" placeholderTextColor={c.foregroundMuted}
            autoCapitalize="none" autoCorrect={false} maxLength={100} value={draft.owner} onChangeText={value => update("owner", value)} style={styles.input} onSubmitEditing={apply} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Repository</Text>
          <TextInput accessibilityLabel="Repository" placeholder={draft.owner ? "Repository name" : "owner/repository"} placeholderTextColor={c.foregroundMuted}
            autoCapitalize="none" autoCorrect={false} maxLength={201} value={draft.repository} onChangeText={value => update("repository", value)} style={styles.input} onSubmitEditing={apply} />
        </View>
      </View>
      {(owners.length > 0 || repositories.length > 0) && <View style={{ gap: 8 }}>
        <Text style={styles.subtitle}>Suggestions from loaded PRs. You can enter any owner or repository above.</Text>
        <View style={styles.row}>{owners.slice(0, 5).map(owner => button(owner, () => update("owner", owner), draft.owner === owner))}</View>
        <View style={styles.row}>{repositories.slice(0, 5).map(repo => button(repo, () => update("repository", repo), draft.repository === repo))}</View>
      </View>}
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Search titles</Text>
        <TextInput accessibilityLabel="Search titles" placeholder="Search PR titles…" placeholderTextColor={c.foregroundMuted}
          maxLength={120} value={draft.text} onChangeText={value => update("text", value)} style={styles.input} onSubmitEditing={apply} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Status</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Status" style={styles.row}>
          {button("All statuses", () => update("status", "all"), draft.status === "all", false, "radio")}
          {button("Ready for review", () => update("status", "ready"), draft.status === "ready", false, "radio")}
          {button("Draft", () => update("status", "draft"), draft.status === "draft", false, "radio")}
        </View>
      </View>
      {tab === "mine" && <View style={{ gap: 8 }}>
        <Text style={styles.label}>Relationship</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Relationship" style={styles.row}>
          {button("Authored or assigned", () => update("relationship", "both"), draft.relationship === "both", false, "radio")}
          {button("Authored by me", () => update("relationship", "authored"), draft.relationship === "authored", false, "radio")}
          {button("Assigned to me", () => update("relationship", "assigned"), draft.relationship === "assigned", false, "radio")}
        </View>
      </View>}
      <View style={styles.row}>
        {button("Apply filters", apply, true)}
        {!filtered && button("Clear filters", clear)}
        {pending && <Text style={styles.subtitle}>Unapplied changes</Text>}
      </View>
      {!!validation && <Text accessibilityRole="alert" style={styles.error}>{validation}</Text>}
    </View>}
    <View style={styles.row}>
      <Text accessibilityLiveRegion="polite" style={styles.subtitle}>
        {firstPage ? `${items.length} of ${firstPage.total} PRs${filtered ? " · Filtered" : ""}` : query.isPending ? "Loading pull requests…" : "Unable to load pull requests"}
      </Text>
      {query.dataUpdatedAt > 0 && <Text style={styles.subtitle}>Updated {new Date(query.dataUpdatedAt).toLocaleTimeString()}</Text>}
    </View>
    {tab === "reviews" && <Text style={styles.subtitle}>Outstanding requests for you and your teams.</Text>}
    {!!query.error && <Text accessibilityRole="alert" style={styles.error}>{firstPage ? "Showing previous results. " : ""}{query.error.message}</Text>}
    {warnings.map(warning => <Text key={warning} accessibilityRole="alert" style={styles.warning}>{warning}</Text>)}
    {firstPage && items.length === 0 && <View style={styles.card}>
      <Text style={styles.prTitle}>{filtered ? "No PRs match these filters" : tab === "mine" ? "No open PRs authored by or assigned to you" : "No reviews waiting for you"}</Text>
      <Text style={styles.subtitle}>{filtered ? "Clear or adjust your filters to see more work." : "Refresh to check for new activity."}</Text>
    </View>}
    {props.navigation && workspaces.isPending && <Text style={styles.subtitle}>Loading Paseo workspaces…</Text>}
    {props.navigation && workspaces.error && <View style={styles.row}><Text accessibilityRole="alert" style={styles.error}>Paseo workspaces unavailable.</Text>{button("Retry workspaces", () => void workspaces.refetch(), false, workspaces.isFetching)}</View>}
    <View>{items.map(pr => <View key={pr.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: c.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${pr.repository} pull request ${pr.number}: ${pr.title}`} onPress={() => setSelectedPr({ repository: pr.repository, number: pr.number })} onHoverIn={() => setHoveredPr(pr.id)} onHoverOut={() => setHoveredPr(null)} onFocus={() => setFocusedPr(pr.id)} onBlur={() => setFocusedPr(null)}
      accessibilityState={{ selected: selectedPr?.repository === pr.repository && selectedPr.number === pr.number }}
      style={({ pressed }) => [styles.card, { flex: 1, minWidth: 0, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1, borderColor: focusedPr === pr.id ? c.accent : "transparent", borderBottomColor: focusedPr === pr.id ? c.accent : "transparent", backgroundColor: pressed || hoveredPr === pr.id ? c.surface2 : c.surface0 }]}>
      <Text numberOfLines={layout.compact ? 2 : 1} style={styles.prTitle}>{pr.title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="GitPullRequest" size={14} color={pr.draft ? c.foregroundMuted : c.accent} />
        <Text numberOfLines={1} style={[styles.subtitle, { flexShrink: 1 }]}>{pr.repository} #{pr.number} · {pr.author} · {new Date(pr.updatedAt).toLocaleDateString()}</Text>
        {pr.draft && <Text style={styles.badge}>Draft</Text>}
      </View>
    </Pressable>
      {props.navigation && workspaces.isSuccess && <PrWorkspaceActions {...props} pr={pr} workspaces={workspaces.data} onSetup={() => setSelectedPr({ repository: pr.repository, number: pr.number })} />}
    </View>)}</View>
    {query.hasNextPage && button(query.isFetchingNextPage ? "Loading more…" : "Load more", () => void query.fetchNextPage(), false, query.isFetching)}
  </ScrollView></>;
}
