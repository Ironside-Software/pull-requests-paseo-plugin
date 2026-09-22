import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { actionRpc, actionSchema, activityRpc, checksRpc, detailsRpc, filesRpc, commitsRpc, type PrAction, type PrKey } from "../shared/details";
import { Markdown } from "./markdown";
import { Diff } from "./diff";
import { checkState, mergeExplanation, reviewSummary } from "./review-state";
import { Control } from "./control";
import { WorkspaceLauncher } from "./workspace-launcher";
import { createReviewWorkspace, listWorkspaces, matchingProjects, matchingWorkspaces, selectWorkspace } from "./integration";

type Props = PluginSurfaceProps & { pr: PrKey; active: boolean; onBack(): void; workspaceId?: string; backLabel?: string; onRefreshContext?(): void };
export function PullRequestDetails({ pr, active, onBack, theme, navigation, host, layout, workspaceId, backLabel = "PRs", onRefreshContext }: Props) {
  const c = theme.colors, paseo = usePaseo(), toast = useToast(), cache = useQueryClient();
  const getDetails = useRpc(detailsRpc), getFiles = useRpc(filesRpc), getActivity = useRpc(activityRpc), getChecks = useRpc(checksRpc), getCommits = useRpc(commitsRpc), performAction = useRpc(actionRpc);
  const [section, setSection] = useState<"overview" | "files" | "discussion" | "commits" | "checks">("overview");
  const [body, setBody] = useState("");
  const [filePath, setFilePath] = useState(""), [fileSearch, setFileSearch] = useState("");
  const [filesOpen, setFilesOpen] = useState(false);
  const [composer, setComposer] = useState<"comment" | "approve" | "request-changes" | "inline-comment" | "reply" | null>(null);
  const [lineTarget, setLineTarget] = useState<{ path: string; line: number; side: "LEFT" | "RIGHT"; headSha: string } | null>(null);
  const [replyTo, setReplyTo] = useState<number | null>(null), [preview, setPreview] = useState(false);
  const [reviewSha, setReviewSha] = useState("");
  const [width, setWidth] = useState(0);
  const contentScroll = useRef<import("react-native").ScrollView>(null);
  const [confirm, setConfirm] = useState<PrAction | null>(null);
  const [integrationError, setIntegrationError] = useState(""), [busy, setBusy] = useState(false);
  const working = useRef(false), submitting = useRef(false);
  const key = ["pull-request", host.id, pr.repository, pr.number];
  const refreshOptions = { enabled: active, refetchInterval: active ? 60_000 : false as const, refetchIntervalInBackground: false, retry: false as const };
  const detail = useQuery({ queryKey: [...key, "details"], queryFn: () => getDetails(pr), ...refreshOptions });
  const data = detail.data;
  const files = useInfiniteQuery({ queryKey: [...key, "files", data?.headSha], initialPageParam: 1,
    queryFn: ({ pageParam }) => getFiles({ ...pr, page: pageParam }), getNextPageParam: page => page.hasMore ? page.page + 1 : undefined,
    enabled: active && section === "files" && !!data, retry: false });
  const activity = useInfiniteQuery({ queryKey: [...key, "activity"], initialPageParam: 1,
    queryFn: ({ pageParam }) => getActivity({ ...pr, page: pageParam }), getNextPageParam: page => page.hasMore ? page.page + 1 : undefined,
    ...refreshOptions });
  const checks = useInfiniteQuery({ queryKey: [...key, "checks", data?.headSha], initialPageParam: 1,
    queryFn: ({ pageParam }) => getChecks({ ...pr, headSha: data!.headSha, page: pageParam }), getNextPageParam: page => page.hasMore ? page.page + 1 : undefined,
    ...refreshOptions, enabled: active && !!data });
  const commits = useInfiniteQuery({ queryKey: [...key, "commits", data?.headSha], initialPageParam: 1,
    queryFn: ({ pageParam }) => getCommits({ ...pr, page: pageParam }), getNextPageParam: page => page.hasMore ? page.page + 1 : undefined,
    enabled: active && section === "commits", retry: false });
  const workspaces = useQuery({ queryKey: ["pr-workspaces", host.id], queryFn: () => listWorkspaces(paseo), enabled: active && !!navigation, retry: false });
  const spaces = data ? matchingWorkspaces(workspaces.data ?? [], data) : [];
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const selectedWorkspace = selectWorkspace(spaces, workspaceId, selectedWorkspaceId);
  const projects = matchingProjects(workspaces.data ?? [], pr.repository);
  const [projectId, setProjectId] = useState("");
  const selectedProject = projects.find(p => p.projectId === projectId) ?? projects[0];
  const mutation = useMutation({ mutationFn: performAction, retry: false, onSuccess: async (result, action) => {
    if ("body" in action) setBody(""); setConfirm(null); setComposer(null); toast.show(result.message, { variant: "success" });
    await Promise.all([cache.invalidateQueries({ queryKey: key }), cache.invalidateQueries({ queryKey: ["pull-requests"] })]);
  } });
  const text = { color: c.foreground, fontSize: 14, lineHeight: 21 }, muted = { color: c.foregroundMuted, fontSize: 12, lineHeight: 18 };
  const row = { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 8 };
  const panel = { paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border, gap: 10 };
  function button(label: string, onPress: () => void, selected = false, disabled = false, icon?: string, role: "button" | "tab" | "radio" = "button") {
    return <Control key={label} theme={theme} compact={layout.compact} label={label} onPress={onPress} selected={selected} disabled={disabled} icon={icon} role={role} />;
  }
  function error(message: string) { return <Text accessibilityRole="alert" style={{ ...text, color: c.statusDanger }}>{message}</Text>; }
  function link(url: string, label: string) { return <ExternalLink href={url} accessibilityLabel={label} onError={() => toast.error("Could not open the link.")}><Text style={{ ...text, color: c.accent }}>{label}</Text></ExternalLink>; }
  async function openWorkspace() {
    if (!data || !navigation || working.current) return;
    working.current = true; setBusy(true); setIntegrationError("");
    try {
      if (workspaces.isPending || workspaces.error) throw new Error("Refresh workspaces before continuing.");
      if (spaces.length && !selectedWorkspace) throw new Error("Select a workspace first.");
      if (!selectedWorkspace && !selectedProject) throw new Error("Open this repository as a project in Paseo first, then refresh.");
      const workspace = selectedWorkspace ? paseo.workspaces.ref(selectedWorkspace) : await createReviewWorkspace(paseo, data, selectedProject!.projectId);
      if (!selectedWorkspace) void cache.invalidateQueries({ queryKey: ["pr-workspaces", host.id] });
      navigation.openWorkspace({ workspaceId: workspace.id, serverId: host.id });
    } catch (err) { setIntegrationError(err instanceof Error ? err.message : "Paseo could not open this PR."); }
    finally { working.current = false; setBusy(false); }
  }
  function prepare(action: PrAction) {
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    mutation.reset(); setConfirm(parsed.data);
  }
  const discussion = [...new Map(activity.data?.pages.flatMap(p => p.items).map(item => [item.id, item]) ?? []).values()].sort((a,b) => a.date.localeCompare(b.date));
  const reviews = reviewSummary(discussion);
  const allChecks = [...new Map(checks.data?.pages.flatMap(p => p.items).map(item => [item.id, item]) ?? []).values()];
  const checkWarnings = [...new Set(checks.data?.pages.flatMap(p => p.warnings) ?? [])];
  const failed = allChecks.filter(item => checkState(item.status) === "fail").length;
  const pending = allChecks.filter(item => checkState(item.status) === "pending").length;
  const unknownChecks = allChecks.filter(item => checkState(item.status) === "neutral").length;
  const checkLabel = checks.error ? "Checks unavailable" : checks.isPending ? "Loading checks" : failed ? `${failed} failed` : pending ? `${pending} pending` : checkWarnings.length ? "Some checks unavailable" : checks.hasNextPage || unknownChecks ? `${allChecks.length} checks loaded` : allChecks.length ? `${allChecks.length} passed` : "No checks reported";
  const checkIcon = failed ? "CircleX" : pending || checks.isPending ? "Clock3" : allChecks.length && !checkWarnings.length && !checks.error && !checks.hasNextPage && !unknownChecks ? "CircleCheck" : "CircleHelp";
  const checkColor = failed ? c.statusDanger : pending ? c.statusWarning : allChecks.length && !checkWarnings.length && !checks.error && !checks.hasNextPage && !unknownChecks ? c.statusSuccess : c.foregroundMuted;
  const loadedFiles = [...new Map(files.data?.pages.flatMap(p => p.items).map(file => [file.path, file]) ?? []).values()];
  const filteredFiles = loadedFiles.filter(file => file.path.toLowerCase().includes(fileSearch.toLowerCase()));
  const selectedFile = loadedFiles.find(file => file.path === filePath) ?? filteredFiles[0] ?? loadedFiles[0];
  const wide = width >= 880;
  const stateColor = data?.state === "merged" ? c.accent : data?.state === "closed" ? c.statusDanger : data?.draft ? c.foregroundMuted : c.statusSuccess;
  const heading = { ...text, fontSize: 13, fontWeight: "600" as const };
  const inputStyle = { ...text, minHeight: 36, padding: 8, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, borderRadius: 5 };
  const mergeText = data ? mergeExplanation(data.mergeState, data.draft, data.mergeable) : "";
  function changeSection(next: typeof section) { setSection(next); contentScroll.current?.scrollTo({ y: 0, animated: false }); }
  function compose(next: NonNullable<typeof composer>) { setComposer(next); setPreview(false); setReviewSha(data?.headSha ?? ""); mutation.reset(); }
  function submitDraft() {
    if (!data || !composer) return;
    if (composer === "inline-comment" && lineTarget) prepare({ ...pr, ...lineTarget, action: composer, body });
    else if (composer === "reply" && replyTo) prepare({ ...pr, action: composer, replyTo, body });
    else if (composer === "comment") prepare({ ...pr, action: composer, body });
    else if (composer === "approve" || composer === "request-changes") prepare({ ...pr, action: composer, body, headSha: reviewSha });
  }
  function selectFile(path: string) { setFilePath(path); setFilesOpen(false); contentScroll.current?.scrollTo({ y: 0, animated: false }); }
  const fileList = <View style={{ gap: 8 }}>
    <TextInput accessibilityLabel="Filter changed files" placeholder="Filter files…" placeholderTextColor={c.foregroundMuted} value={fileSearch} onChangeText={setFileSearch} autoCapitalize="none" autoCorrect={false} style={inputStyle} />
    <Text style={muted}>{loadedFiles.length} of {data?.files ?? 0} files loaded</Text>
    {filteredFiles.map(file => <Pressable key={file.path} accessibilityRole="button" accessibilityLabel={`View diff ${file.path}`} accessibilityState={{ selected: selectedFile?.path === file.path }} onPress={() => selectFile(file.path)}
      style={({ pressed }) => ({ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 4, backgroundColor: selectedFile?.path === file.path || pressed ? c.surface2 : "transparent", gap: 3 })}>
      <Text numberOfLines={2} style={{ ...text, fontSize: 12 }}>{file.path}</Text><View style={{ ...row, gap: 5 }}><Text style={{ ...muted, color: c.statusSuccess }}>+{file.additions}</Text><Text style={{ ...muted, color: c.statusDanger }}>−{file.deletions}</Text>{file.status !== "modified" && <Text style={muted}>{file.status}</Text>}</View>
    </Pressable>)}
    {loadedFiles.length > 0 && !filteredFiles.length && <Text style={muted}>No loaded files match. Clear the filter or load more files.</Text>}
    {files.hasNextPage && button(files.isFetchingNextPage ? "Loading files…" : "Load more files", () => void files.fetchNextPage(), false, files.isFetching, "ChevronsDown")}
    {files.error && error(files.error.message)}
  </View>;
  function summary() { return <View style={{ gap: 0 }}>
    <View style={panel}><Text style={heading}>Reviewers</Text>
      {reviews.map(review => <View key={review.author} style={row}><Icon name={review.state === "APPROVED" ? "CircleCheck" : review.state === "CHANGES_REQUESTED" ? "CircleAlert" : "CircleMinus"} size={14} color={review.state === "APPROVED" ? c.statusSuccess : c.statusWarning} /><Text style={text}>{review.author}</Text><Text style={muted}>{review.state === "APPROVED" ? "Approved" : review.state === "CHANGES_REQUESTED" ? "Changes requested" : "Dismissed"}</Text></View>)}
      {data?.reviewers.map(name => <View key={name} style={row}><Icon name="Clock3" size={14} color={c.foregroundMuted} /><Text style={text}>{name}</Text></View>)}
      {!reviews.length && !data?.reviewers.length && <Text style={muted}>{activity.isPending ? "Loading reviews…" : "No reviews requested"}</Text>}
      {activity.hasNextPage && button("Load more reviews", () => void activity.fetchNextPage(), false, activity.isFetching)}
      {activity.error && error("Reviews could not be loaded. Refresh to retry.")}
    </View>
    <View style={panel}><View style={row}><Icon name={checkIcon} size={16} color={checkColor} /><Text style={heading}>{checkLabel}</Text></View>{button("View checks", () => changeSection("checks"), false, false, "ArrowRight")}</View>
    <View style={panel}><Text style={heading}>Assignees</Text><Text style={data?.assignees.length ? text : muted}>{data?.assignees.join(", ") || "No one assigned"}</Text>{!!data?.labels.length && <><Text style={heading}>Labels</Text><View style={row}>{data.labels.map(label => <Text key={label} style={{ ...muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: c.surface2 }}>{label}</Text>)}</View></>}</View>
    {data?.state === "open" && <View style={panel}><Text style={heading}>Merge status</Text><Text style={muted}>{mergeText}</Text>
      {data.canMerge && data.mergeMethods.length > 0 ? button("Merge pull request", () => prepare({ ...pr, action: "merge", method: data.mergeMethods[0], headSha: data.headSha }), false, mutation.isPending, "GitMerge") : !data.draft && data.mergeable !== false && <Text style={muted}>Merging is unavailable for this account or repository.</Text>}
    </View>}

  </View>; }
  return <View style={{ flex: 1, backgroundColor: c.surface0 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={{ paddingHorizontal: layout.compact ? 12 : 20, paddingTop: 8, gap: 8, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ ...row, justifyContent: "space-between" }}>
        <View style={{ ...row, flex: 1, minWidth: 0 }}>{button(backLabel, onBack, false, busy || mutation.isPending, "ArrowLeft")}<Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>{pr.repository} #{pr.number}</Text></View>
        {button("Refresh", () => { onRefreshContext?.(); void cache.invalidateQueries({ queryKey: key }); void workspaces.refetch(); void cache.invalidateQueries({ queryKey: ["pr-providers", host.id] }); }, false, detail.isFetching, "RefreshCw")}
      </View>
      {data ? <>
        <Text accessibilityRole="header" style={{ ...text, fontSize: layout.compact ? 18 : 21, lineHeight: layout.compact ? 25 : 28, fontWeight: "600" }}>{data.title}</Text>
        <View style={row}><View style={{ ...row, gap: 4, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: c.surface1, borderRadius: 5 }}><Icon name={data.state === "merged" ? "GitMerge" : data.state === "closed" ? "GitPullRequestClosed" : "GitPullRequest"} size={14} color={stateColor} /><Text style={{ ...muted, color: stateColor }}>{data.draft ? "Draft" : data.state[0].toUpperCase() + data.state.slice(1)}</Text></View><Text style={muted}>{data.author}</Text><Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>{data.head} → {data.base}</Text></View>
        <View style={{ ...row, justifyContent: "space-between" }}><View style={row}><Text style={{ ...muted, color: c.statusSuccess }}>+{data.additions}</Text><Text style={{ ...muted, color: c.statusDanger }}>−{data.deletions}</Text><Text style={muted}>{data.commits} commits</Text></View><View style={{ ...row, gap: 2 }}>{link(data.url, "GitHub")}{button(data.canReview ? "Review" : "Comment", () => compose("comment"), true, mutation.isPending, "MessageSquare")}{data.canMerge && data.mergeMethods.length > 0 && button("Merge", () => prepare({ ...pr, action: "merge", method: data.mergeMethods[0], headSha: data.headSha }), false, mutation.isPending, "GitMerge")}</View></View>
      </> : <View style={{ paddingVertical: 16, gap: 10 }}><View style={{ width: "75%", height: 22, backgroundColor: c.surface2, borderRadius: 4 }} /><View style={{ width: "45%", height: 14, backgroundColor: c.surface1, borderRadius: 3 }} /><Text accessibilityLiveRegion="polite" style={muted}>{detail.error ? "Pull request unavailable" : "Loading pull request…"}</Text></View>}
      {detail.error && error(`${data ? "Showing previous details. " : ""}${detail.error.message}`)}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 4 }}>
        {([['overview', 'Overview'], ['files', `Files${data ? ` ${data.files}` : ""}`], ['discussion', 'Activity'], ['commits', 'Commits'], ['checks', 'Checks']] as const).map(([id,label]) => button(label, () => changeSection(id), section === id, false, undefined, "tab"))}
      </ScrollView>
    </View>
    {data && <View style={{ flex: 1, flexDirection: "row" }}>
      {section === "files" && wide && <ScrollView style={{ width: 260, flexGrow: 0, borderRightWidth: 1, borderColor: c.border, backgroundColor: c.surface1 }} contentContainerStyle={{ padding: 12 }}>{fileList}</ScrollView>}
      <ScrollView ref={contentScroll} style={{ flex: 1 }} contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: 18 }} keyboardShouldPersistTaps="handled">
        {section === "overview" && <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? 28 : 20, width: "100%", maxWidth: 1120, alignSelf: "center" }}>
          <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: 16 }}>
        {navigation && <View style={{ gap: 8, paddingVertical: 8 }}>
          {spaces.length > 1 && <View accessibilityRole="radiogroup" accessibilityLabel="PR workspace" style={row}>
            {spaces.map(space => button(space.name, () => setSelectedWorkspaceId(space.id), selectedWorkspace?.id === space.id, busy, undefined, "radio"))}
          </View>}
          {!spaces.length && projects.length > 1 && <View accessibilityRole="radiogroup" accessibilityLabel="Worktree project" style={row}>
            {projects.map(project => button(project.projectRootPath, () => setProjectId(project.projectId), selectedProject?.projectId === project.projectId, busy, undefined, "radio"))}
          </View>}
          <View style={row}>
            {button(busy ? "Opening…" : spaces.length ? "Open workspace" : "Create PR worktree", () => void openWorkspace(), false, busy || workspaces.isPending || !!workspaces.error || (spaces.length ? !selectedWorkspace : !selectedProject), "FolderGit2")}

          </View>
          {selectedWorkspace && <WorkspaceLauncher key={selectedWorkspace.id} theme={theme} layout={layout} host={host} navigation={navigation}
            workspace={selectedWorkspace} number={pr.number} disabled={busy || !!workspaces.error} onBusyChange={setBusy} />}
          {workspaces.isPending && <Text style={muted}>Loading workspaces…</Text>}
          {!workspaces.isPending && !workspaces.error && !spaces.length && !projects.length && <Text style={muted}>Open this repository in Paseo first to create its PR worktree.</Text>}
          {!!spaces.length && !selectedWorkspace && <Text style={muted}>Select a workspace to continue.</Text>}
          {workspaces.error && error("Workspaces could not be loaded. Refresh to retry.")}{!!integrationError && error(integrationError)}
        </View>}
<View style={{ ...row, justifyContent: "space-between" }}><Text style={heading}>Description</Text><Text style={muted}>Updated {new Date(data.updatedAt).toLocaleDateString()}</Text></View>
            <View style={{ maxWidth: 760 }}><Markdown body={data.body || "No description provided."} theme={theme} baseUrl={data.url} /></View>
            <View style={{ ...row, marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderColor: c.border }}>{button("View conversation", () => changeSection("discussion"), false, false, "MessagesSquare")}{button("Browse changes", () => changeSection("files"), false, false, "FileDiff")}</View>
          </View>
          <View style={wide ? { width: 260, paddingLeft: 20, borderLeftWidth: 1, borderColor: c.border } : { borderTopWidth: 1, borderColor: c.border }}>{summary()}</View>
        </View>}
        {section === "files" && <>
          {!wide && <View style={{ gap: 8 }}><View style={{ ...row, justifyContent: "space-between" }}><Control theme={theme} compact={layout.compact} label="Changed files" icon="Files" expanded={filesOpen} onPress={() => setFilesOpen(open => !open)} disabled={files.isPending} /><Text style={muted}>{selectedFile ? loadedFiles.indexOf(selectedFile) + 1 : 0} / {data.files}</Text></View>{filesOpen && <View style={{ maxHeight: 300 }}><ScrollView nestedScrollEnabled>{fileList}</ScrollView></View>}</View>}
          {files.isPending && <Text style={muted}>Loading changed files…</Text>}{files.error && error(files.error.message)}
          {selectedFile && <View style={{ gap: 10 }}>
            <View style={{ ...row, justifyContent: "space-between" }}><Text selectable style={{ ...heading, flex: 1 }}>{selectedFile.path}</Text><Text style={{ ...muted, color: c.statusSuccess }}>+{selectedFile.additions}</Text><Text style={{ ...muted, color: c.statusDanger }}>−{selectedFile.deletions}</Text>{link(selectedFile.url, "View file")}</View>
            {selectedFile.previousPath && <Text style={muted}>Renamed from {selectedFile.previousPath}</Text>}
            {selectedFile.patch ? <Diff key={`${selectedFile.path}:${data.headSha}`} patch={selectedFile.patch} path={selectedFile.path} theme={theme} compact={!wide} canComment={data.state === "open"} onComment={(line, side) => { setLineTarget({ path: selectedFile.path, line, side, headSha: data.headSha }); compose("inline-comment"); }} /> : <View style={{ paddingVertical: 32, gap: 10 }}><Text style={heading}>No text diff available</Text><Text style={muted}>This file may be binary, unchanged after a rename, or too large for GitHub's preview.</Text>{link(selectedFile.url, "Open complete file")}</View>}
            <View style={{ ...row, justifyContent: "space-between" }}>{button("Previous file", () => selectFile(loadedFiles[loadedFiles.indexOf(selectedFile) - 1].path), false, loadedFiles.indexOf(selectedFile) <= 0, "ArrowLeft")}{button("Next file", () => selectFile(loadedFiles[loadedFiles.indexOf(selectedFile) + 1].path), false, loadedFiles.indexOf(selectedFile) >= loadedFiles.length - 1, "ArrowRight")}</View>
            <Text style={muted}>Large patches may be truncated by GitHub. Use “View file” for complete content.</Text>
          </View>}
          {files.isSuccess && !loadedFiles.length && <Text style={muted}>This PR has no changed files.</Text>}
          {files.data?.pages.map(p => p.warning && <Text key={p.page} style={muted}>{p.warning}</Text>)}
          {!wide && files.hasNextPage && button("Load more files", () => void files.fetchNextPage(), false, files.isFetching)}
        </>}
        {section === "discussion" && <>
          <View style={{ ...row, justifyContent: "space-between" }}><Text style={heading}>Conversation</Text>{button("Add comment", () => compose("comment"), false, mutation.isPending, "MessageSquarePlus")}</View>
          {activity.isPending && <Text style={muted}>Loading conversation…</Text>}{activity.error && error(activity.error.message)}
          {activity.isSuccess && !discussion.length && <View style={{ paddingVertical: 32, gap: 8 }}><Text style={heading}>Start the conversation</Text><Text style={muted}>No comments or reviews yet. Add a comment or select a line in Files to discuss a change.</Text></View>}
          {discussion.map(item => <View key={item.id} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ alignItems: "center", width: 24, gap: 6 }}><Icon name={item.kind === "review" ? "GitPullRequest" : "MessageSquare"} size={16} color={item.state === "APPROVED" ? c.statusSuccess : c.foregroundMuted} /><View style={{ width: 1, flex: 1, backgroundColor: c.border }} /></View>
            <View style={{ flex: 1, minWidth: 0, paddingBottom: 14, gap: 10 }}><View style={row}><Text style={heading}>{item.author}</Text><Text style={muted}>{item.state?.replaceAll("_", " ").toLowerCase() ?? (item.replyTo ? "replied" : "commented")}</Text><Text style={muted}>{new Date(item.date).toLocaleString()}</Text></View>
              {item.path && <View style={{ padding: 10, gap: 6, backgroundColor: c.surface1, borderRadius: 5 }}><Text style={{ ...muted, fontFamily: "monospace" }}>{item.path}{item.line ? `:${item.line}` : ""}</Text>{item.diffHunk && <ScrollView horizontal><Text selectable style={{ ...muted, fontFamily: "monospace" }}>{item.diffHunk.split("\n").slice(-5).join("\n")}</Text></ScrollView>}</View>}
              <Markdown body={item.body || "No review comment."} theme={theme} baseUrl={data.url} />
              <View style={row}>{item.commentId && button("Reply", () => { setReplyTo(item.replyTo ?? item.commentId); compose("reply"); }, false, mutation.isPending, "Reply")}{link(item.url, "GitHub")}</View>
            </View>
          </View>)}
          {activity.hasNextPage && button("Load more activity", () => void activity.fetchNextPage(), false, activity.isFetching)}
        </>}
        {section === "commits" && <>
          <Text style={heading}>{data.commits} commits in this pull request</Text>
          {commits.isPending && <Text style={muted}>Loading commits…</Text>}{commits.error && error(commits.error.message)}
          {commits.data?.pages.flatMap(p => p.items).map(commit => <View key={commit.sha} style={{ ...panel, paddingTop: 0 }}><View style={row}><Icon name="GitCommitHorizontal" size={16} color={c.foregroundMuted} /><Text style={{ ...text, flex: 1, fontWeight: "500" }}>{commit.message.split("\n")[0]}</Text>{link(commit.url, commit.sha.slice(0,7))}</View><Text style={muted}>{commit.author} · {new Date(commit.date).toLocaleString()}</Text></View>)}
          {commits.hasNextPage && button("Load more commits", () => void commits.fetchNextPage(), false, commits.isFetching)}
          {commits.data?.pages.map(page => page.warning && <Text key={page.page} style={muted}>{page.warning}</Text>)}
        </>}
        {section === "checks" && <>
          <View style={row}><Icon name={checkIcon} size={18} color={checkColor} /><Text style={heading}>{checkLabel}</Text>{checks.hasNextPage && <Text style={muted}>More checks available</Text>}</View>
          {checks.error && error(checks.error.message)}{checkWarnings.map(w => <Text key={w} style={{ ...text, color: c.statusWarning }}>{w}</Text>)}
          {allChecks.map(check => { const status = checkState(check.status); return <View key={check.id} style={{ ...panel, paddingTop: 0, ...row }}><Icon name={status === "pass" ? "CircleCheck" : status === "fail" ? "CircleX" : "Clock3"} size={16} color={status === "pass" ? c.statusSuccess : status === "fail" ? c.statusDanger : c.foregroundMuted} /><View style={{ flex: 1 }}><Text style={text}>{check.name}</Text><Text style={muted}>{check.status.replaceAll("_", " ")}</Text></View>{check.url && link(check.url, "Details")}</View>; })}
          {checks.hasNextPage && button("Load more checks", () => void checks.fetchNextPage(), false, checks.isFetching)}
        </>}
      </ScrollView>
    </View>}
    <Modal title={composer === "inline-comment" ? "Comment on a line" : composer === "reply" ? "Reply to thread" : data?.canReview ? "Review pull request" : "Add a comment"} open={!!composer && !confirm} onOpenChange={open => { if (!open && !mutation.isPending) setComposer(null); }}>
      <Modal.Content contentContainerStyle={{ padding: 18, gap: 14 }}>
        <Text style={muted}>{pr.repository} #{pr.number} · Posting as @{data?.login}</Text>
        {composer === "inline-comment" && lineTarget && <Text style={{ ...heading, fontFamily: "monospace" }}>{lineTarget.path}:{lineTarget.line} ({lineTarget.side === "LEFT" ? "old" : "new"})</Text>}
        {data?.canReview && composer !== "inline-comment" && composer !== "reply" && <View accessibilityRole="radiogroup" accessibilityLabel="Review outcome" style={row}>{button("Comment", () => setComposer("comment"), composer === "comment", false, "MessageSquare", "radio")}{button("Approve", () => setComposer("approve"), composer === "approve", false, "CircleCheck", "radio")}{button("Request changes", () => setComposer("request-changes"), composer === "request-changes", false, "CircleAlert", "radio")}</View>}
        <View style={row}>{button("Write", () => setPreview(false), !preview, false, undefined, "tab")}{button("Preview", () => setPreview(true), preview, false, undefined, "tab")}</View>
        {preview ? <View style={{ minHeight: 160 }}><Markdown body={body || "Nothing to preview yet."} theme={theme} baseUrl={data?.url ?? "https://github.com"} /></View> : <TextInput accessibilityLabel="Comment or review body" multiline maxLength={65536} placeholder={composer === "approve" ? "Optional review summary…" : "Write a comment… Markdown is supported."} placeholderTextColor={c.foregroundMuted} value={body} onChangeText={setBody} style={{ ...inputStyle, minHeight: 160, textAlignVertical: "top" }} />}
        {data && reviewSha && data.headSha !== reviewSha && composer !== "comment" && composer !== "reply" && <Text style={{ ...text, color: c.statusWarning }}>New commits arrived while you were writing. Your text is saved; close this form and review the latest changes.</Text>}
        <View style={{ ...row, justifyContent: "flex-end" }}>{button("Close", () => setComposer(null))}{button(composer === "approve" ? "Submit approval…" : composer === "request-changes" ? "Request changes…" : "Post comment…", submitDraft, true, (composer !== "approve" && !body.trim()) || mutation.isPending)}</View>
      </Modal.Content>
    </Modal>
    <Modal title={confirm?.action === "merge" ? "Merge pull request?" : "Submit to GitHub?"} open={!!confirm} onOpenChange={open => { if (!open && !mutation.isPending) setConfirm(null); }}>
      <Modal.Content contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={text}>{confirm?.action === "merge" ? `Merge ${pr.repository} #${pr.number} into ${data?.base} at ${confirm.headSha.slice(0,7)}. This changes the base branch.` : `${confirm?.action.replaceAll("-", " ")} on ${pr.repository} #${pr.number} as @${data?.login}.`}</Text>
        {confirm?.action === "merge" && <><Text style={muted}>{mergeText}</Text><View accessibilityRole="radiogroup" accessibilityLabel="Merge method" style={row}>{data?.mergeMethods.map(method => button(({ squash: "Squash", merge: "Merge commit", rebase: "Rebase" })[method], () => setConfirm({ ...confirm, method }), confirm.method === method, mutation.isPending, undefined, "radio"))}</View></>}
        {confirm?.action === "inline-comment" && <Text style={{ ...heading, fontFamily: "monospace" }}>{confirm.path}:{confirm.line} ({confirm.side === "LEFT" ? "old" : "new"}) · {confirm.headSha.slice(0,7)}</Text>}
        {confirm && "body" in confirm && !!confirm.body && <Markdown body={confirm.body} theme={theme} baseUrl={data?.url ?? "https://github.com"} />}
        {mutation.error && error(`${mutation.error.message} Check GitHub before retrying if the result is uncertain.`)}
        <View style={{ ...row, justifyContent: "flex-end" }}>{button("Cancel", () => setConfirm(null), false, mutation.isPending)}{button(mutation.isPending ? "Submitting…" : confirm?.action === "merge" ? "Confirm merge" : "Confirm submission", () => { if (confirm && !submitting.current) { submitting.current = true; mutation.mutate(confirm, { onSettled: () => { submitting.current = false; } }); } }, true, mutation.isPending)}</View>
      </Modal.Content>
    </Modal>
  </View>;
}
