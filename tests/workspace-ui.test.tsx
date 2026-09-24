import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPaseoApi } from "@getpaseo/client";
import { registerHooks } from "node:module";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let workspace: any = { id: "current", name: "Current", projectId: "project", projectRootPath: "/repo", workspaceDirectory: "/repo/worktree", gitRuntime: { remoteUrl: "git@github.com:acme/widget.git" }, githubRuntime: { pullRequest: { url: "https://github.com/acme/widget/pull/42" } } };
let matches: any[] = [], providers: any[] = [], refreshFail = false, createFail = false;
let listItems: any[] = [], workspaceLists = 0;
let terminalOptions: any;
let terminals = 0, agentOptions: any[] = [];
let created = 0, agents = 0, opened = "", requests: any[] = [];
let changedFiles: any[] = [];
const wireOptions: any[] = [];
const sdk = createPaseoApi({ createAgent: async (options: any) => { wireOptions.push(options); return { id: "agent" }; } } as any);
const api = {
  workspaces: {
    ref: (value: any) => ({ id: typeof value === "string" ? value : value.id, refresh: async () => { if (refreshFail) throw Error("offline"); return workspace; }, terminals: { create: async (options: any) => { terminals++; terminalOptions = options; } }, agents: { create: async (options: any) => { const agent = await sdk.agents.create({ ...options, cwd: "/repo/worktree" }); agents++; agentOptions.push(options); return agent; } } }),
    list: async () => { workspaceLists++; return { entries: matches, pageInfo: {} }; },
    create: async () => { created++; if (createFail) throw Error("creation failed"); return api.workspaces.ref("new"); },
  },
  providers: { waitForReady: async () => ({ entries: providers }) },
};
const details = { repository: "acme/widget", number: 42, title: "Improve workspace navigation", url: "https://github.com/acme/widget/pull/42", state: "open", draft: false, author: "alice", login: "alice", head: "feature", base: "main", headSha: "a".repeat(40), mergeSha: null, body: "Example description", updatedAt: "2026-09-22", files: 1, commits: 1, additions: 3, deletions: 1, reviewers: ["reviewer"], assignees: ["alice"], labels: [{ name: "existing", color: "0e8a16" }], mergeable: true, mergeState: "clean", canMerge: false, canReview: false, mergeMethods: [] };
Object.assign(globalThis, {
  __prTest: {
    api,
    rpc: (contract: any) => async (input: any) => {
      requests.push({ name: contract.name, input });
      if (contract.name.endsWith(".details")) return details;
      if (contract.name.endsWith(".list")) return { login: "alice", items: listItems, total: listItems.length, page: 1, hasMore: false, warnings: [] };
      if (contract.name.endsWith(".preview")) return { url: "https://preview.example.test", environment: "Preview" };
      if (contract.name.endsWith(".preview-for-pr")) return { url: "https://preview.example.test", environment: "Preview" };
      if (contract.name.endsWith(".labels")) return { items: [{ name: "bug", color: "d73a4a" }, { name: "enhancement", color: "a2eeef" }], page: 1, hasMore: false };
      if (contract.name.endsWith(".branches")) return { items: ["main", "release"], page: 1, hasMore: false };
      if (contract.name.endsWith(".files")) return { items: changedFiles, page: 1, hasMore: false, warning: null };
      if (contract.name.endsWith(".edit")) return { message: "Pull request updated." };
      return { items: [], hasMore: false, warnings: [] };
    },
  },
});
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (["react-native", "@getpaseo/plugin/client", "@getpaseo/plugin/client/react-native", "@getpaseo/plugin/client/ui"].includes(specifier)) return { url: "pr-test:" + specifier, shortCircuit: true };
    return next(specifier, context.parentURL?.startsWith("pr-test:") ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (!url.startsWith("pr-test:")) return next(url, context);
    const source = url === "pr-test:@getpaseo/plugin/client"
      ? "export const usePaseo = () => globalThis.__prTest.api; export const useRpc = contract => globalThis.__prTest.rpc(contract);"
      : `import React from "react";
         const component = name => React.forwardRef((props, ref) => React.createElement(name, {...props, ref}, props.children));
         export const Image=component("Image"), Linking={openURL:async()=>{}}, View=component("View"), Text=component("Text"), Pressable=component("Pressable"), ScrollView=component("ScrollView"), TextInput=component("TextInput"), Icon=component("Icon"), ExternalLink=component("ExternalLink");
         export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent,...props})=>React.createElement("FlatList",props,ListHeaderComponent,data.map((item,index)=>React.createElement(React.Fragment,{key:keyExtractor(item,index)},renderItem({item,index}))),ListFooterComponent);
         export const StyleSheet={create: x=>x}, AppState={currentState:"active",addEventListener:()=>({remove(){}})}, Platform={OS:"web"};
         export const Modal=({open,children})=>open?children:null; Modal.Content=component("ModalContent");
         export const useToast=()=>({show(){},error(){}});`;
    return { source, format: "module", shortCircuit: true };
  },
});
const { WorkspacePullRequests } = await import("../index.client");
const { PullRequestDetails } = await import("../client/details");
const { PullRequestsSurface } = await import("../client/pull-requests");
after(() => hooks.deregister());
const props = {
  workspaceId: "current", host: { id: "host-one" }, layout: { compact: false },
  theme: { colors: new Proxy({}, { get: () => "#888" }) },
  navigation: { openWorkspace: ({ workspaceId }: any) => { opened = workspaceId; }, openAgent: ({ agentId }: any) => { opened = agentId; } },
} as unknown as PluginWorkspacePanelProps;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 35));

test("workspace panel routes linked PRs, preserves drafts, handles failures and isolates hosts", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root!: ReactTestRenderer;
  const render = (host = "host-one") => <QueryClientProvider client={cache}><WorkspacePullRequests {...props} host={{ ...props.host, id: host }} /></QueryClientProvider>;
  const text = () => JSON.stringify(root.toJSON());
  const click = async (label: string) => { await act(async () => root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0].props.onPress()); await act(tick); };
  try {
    await act(async () => { root = create(render()); }); await act(tick); await act(tick);
    assert.match(text(), /Improve workspace navigation/);
    await click("Comment");
    const input = root.root.findAll(node => String(node.type) === "TextInput" && node.props.accessibilityLabel === "Comment or review body")[0];
    await act(async () => input.props.onChangeText("Keep my review"));
    await click("Refresh");
    assert.match(text(), /Keep my review/);
    await click("Close");
    await click("Repository PRs");
    assert.equal(requests.filter(r => r.name.endsWith(".list")).at(-1).input.filters.repository, "acme/widget");
    assert.match(text(), /Open workspace PR/);
    refreshFail = true;
    await act(async () => root.update(render("host-two"))); await act(tick);
    assert.match(text(), /Workspace could not be loaded/);
    refreshFail = false;
    workspace = { ...workspace, githubRuntime: null };
    await click("Retry"); await act(tick);
    assert.match(text(), /No open PRs authored/);
    assert.match(text(), /No linked PR for/);
    workspace = { ...workspace, gitRuntime: null };
    await act(async () => root.update(render("host-three"))); await act(tick);
    assert.match(text(), /no supported GitHub repository/);
    await click("Open all PRs");
    assert.equal(requests.filter(r => r.name.endsWith(".list")).at(-1).input.filters.repository, "");
  } finally { await act(async () => root.unmount()); cache.clear(); }
});

test("a linked PR arriving after cached workspace data opens its details", async () => {
  const cache = new QueryClient();
  const linkedWorkspace = { ...workspace, gitRuntime: { remoteUrl: "git@github.com:acme/widget.git" }, githubRuntime: { pullRequest: { url: details.url } } };
  cache.setQueryData(["pr-workspace", "host-late", "current"], { ...linkedWorkspace, githubRuntime: null });
  workspace = linkedWorkspace;
  let root!: ReactTestRenderer;
  const click = async (label: string) => { await act(async () => root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0].props.onPress()); await act(tick); };
  try {
    await act(async () => { root = create(<QueryClientProvider client={cache}><WorkspacePullRequests {...props} host={{ ...props.host, id: "host-late" }} /></QueryClientProvider>); });
    await act(tick); await act(tick);
    assert.equal(root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Repository PRs").length, 1);
    await click("Repository PRs");
    await click("Refresh");
    assert.equal(root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Repository PRs").length, 0);
    assert.match(JSON.stringify(root.toJSON()), /Open workspace PR/);
  } finally { await act(async () => root.unmount()); cache.clear(); }
});

test("workspace actions select valid provider models, require workspace selection, and recover from failure", async () => {
  const cache = new QueryClient();
  let root!: ReactTestRenderer;
  const click = async (label: string) => { await act(async () => root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0].props.onPress()); await act(tick); };
  const button = (label: string) => root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0];
  matches = ["a", "b"].map(id => ({ ...workspace, id, name: id, githubRuntime: { pullRequest: { url: details.url } }, gitRuntime: { remoteUrl: "git@github.com:acme/widget.git" } }));
  try {
    await act(async () => { root = create(<QueryClientProvider client={cache}><PullRequestDetails {...props} workspaceId="unknown" pr={{ repository: "acme/widget", number: 42 }} active onBack={() => {}} /></QueryClientProvider>); }); await act(tick); await act(tick);
    assert.equal(button("Open workspace").props.disabled, true);
    await click("b"); await click("Open workspace"); assert.equal(opened, "b"); assert.equal(created, 0);
    await click("Open…"); await click("Terminal"); assert.equal(terminals, 1); assert.deepEqual(terminalOptions, { cwd: "/repo/worktree" }); assert.equal(opened, "b");
    providers = [{ enabled: true, status: "ready", provider: "codex", label: "Codex", models: [{ id: "hidden", isDefault: true, isSelectable: false }, { id: "other" }, { id: "default-model", isDefault: true }] }, { enabled: false, status: "ready", provider: "claude", label: "Claude", models: [] }];
    await click("Refresh"); await click("Open…");
    assert.equal(root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Claude").length, 0);
    await act(async () => { const press = button("Codex").props.onPress; press(); press(); }); await act(tick);
    assert.equal(agents, 1); assert.deepEqual(agentOptions[0].config, { provider: "codex/default-model" }); assert.equal(wireOptions[0].config.provider, "codex"); assert.equal(wireOptions[0].config.model, "default-model"); assert.equal(agentOptions[0].prompt, undefined);
    providers = [{ enabled: true, status: "ready", provider: "codex", label: "Codex", models: [] }];
    await click("Refresh"); await click("Open…");
    assert.equal(button("Codex").props.disabled, true);
    await click("Codex"); assert.equal(agents, 1);
    providers = [{ enabled: true, status: "ready", provider: "claude", label: "Claude", models: [{ id: "first-model" }] }];
    await click("Refresh"); await click("Claude");
    assert.equal(agents, 2); assert.equal(wireOptions.at(-1).config.model, "first-model");
    assert.equal(wireOptions.at(-1).config.provider, "claude");
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Review with agent|Start review agent/);
    matches = [{ ...matches[0], githubRuntime: null }];
    await click("Refresh");
    createFail = true;
    await click("Create PR worktree"); assert.equal(created, 1);
    assert.match(JSON.stringify(root.toJSON()), /creation failed/);
    createFail = false;
    await act(async () => { const press = button("Create PR worktree").props.onPress; press(); press(); }); await act(tick);
    assert.equal(created, 2); assert.equal(opened, "new");

  } finally { await act(async () => root.unmount()); cache.clear(); }
});

test("preview, split diff and PR metadata controls reach the intended RPCs", async () => {
  changedFiles = [{ path: "src/app.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-const oldValue = 1;\n+const newValue = 2;", url: "https://github.com/acme/widget/blob/feature/src/app.ts" }];
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root!: ReactTestRenderer;
  const button = (label: string) => root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0];
  const click = async (label: string) => { assert.ok(button(label), label); await act(async () => button(label).props.onPress()); await act(tick); };
  const input = (label: string) => root.root.findAll(node => String(node.type) === "TextInput" && node.props.accessibilityLabel === label)[0];
  const lastEdit = () => requests.filter(request => request.name === "pull-requests.edit").at(-1)?.input;
  try {
    await act(async () => { root = create(<QueryClientProvider client={cache}><PullRequestDetails {...props} host={{ ...props.host, id: "host-features" }} pr={{ repository: "acme/widget", number: 42 }} active onBack={() => {}} /></QueryClientProvider>); });
    await act(tick);
    assert.match(JSON.stringify(root.toJSON()), /Preview · Preview/);
    assert.match(JSON.stringify(root.toJSON()), /#0e8a16/);
    await click("Edit labels");
    assert.ok(input("Filter labels"));
    assert.equal(root.root.findAll(node => String(node.type) === "ModalContent").length, 0);
    await click("bug");
    assert.deepEqual(lastEdit(), { repository: "acme/widget", number: 42, action: "add-label", name: "bug" });
    await click("existing");
    assert.deepEqual(lastEdit(), { repository: "acme/widget", number: 42, action: "remove-label", name: "existing" });
    await click("Done"); await click("Edit assignees");
    await act(async () => input("Assignee username").props.onChangeText("bob")); await click("Add assignee");
    assert.equal(lastEdit().action, "add-assignee");
    await click("Remove alice"); assert.equal(lastEdit().action, "remove-assignee");
    await click("Done"); await click("Edit reviewers");
    await act(async () => input("Reviewer username or team").props.onChangeText("@acme/owners")); await click("Add reviewer");
    assert.equal(lastEdit().name, "@acme/owners");
    await click("Remove reviewer"); assert.equal(lastEdit().action, "remove-reviewer");
    await click("Done"); await click("Change target branch");
    assert.ok(input("Filter target branches"));
    assert.equal(root.root.findAll(node => String(node.type) === "ModalContent").length, 0);
    await click("release"); await click("Confirm target change");
    assert.deepEqual(lastEdit(), { repository: "acme/widget", number: 42, action: "change-base", base: "release", expectedBase: "main" });
    await act(async () => root.root.findAll(node => typeof node.props.onLayout === "function")[0].props.onLayout({ nativeEvent: { layout: { width: 1100 } } }));
    await click("Files 1"); await click("Split");
    assert.ok(button("Comment on src/app.ts old line 1")); assert.ok(button("Comment on src/app.ts new line 1"));
    assert.match(JSON.stringify(root.toJSON()), /#ff7b72/);
  } finally { await act(async () => root.unmount()); cache.clear(); changedFiles = []; }
});


test("PR list shares workspace lookup and launches independently of opening PR details", async () => {
  const cache = new QueryClient();
  let root!: ReactTestRenderer;
  listItems = [42, 43].map(number => ({ ...details, id: number, number, title: `PR ${number}`, url: `https://github.com/acme/widget/pull/${number}`, authored: true, assigned: false, labels: number === 42 ? [{ name: "bug", color: "d73a4a" }, { name: "needs review", color: "a2eeef" }] : [] }));
  matches = [{ ...workspace, id: "existing", name: "Existing PR workspace", githubRuntime: { pullRequest: { url: details.url } } }];
  workspaceLists = 0; requests = [];
  const button = (label: string) => root.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0];
  const click = async (label: string) => { await act(async () => button(label).props.onPress()); await act(tick); };
  try {
    await act(async () => { root = create(<QueryClientProvider client={cache}><PullRequestsSurface {...props} /></QueryClientProvider>); });
    await act(tick); await act(tick);
    assert.match(JSON.stringify(root.toJSON()), /needs review/);
    assert.match(JSON.stringify(root.toJSON()), /#d73a4a/);
    assert.ok(root.root.findAll(node => String(node.type) === "ExternalLink" && node.props.accessibilityLabel === "Open preview for acme/widget pull request 42").length);
    assert.equal(workspaceLists, 1);
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Workspace: Existing PR workspace/);
    await click("Paseo actions for acme/widget #42");
    assert.match(JSON.stringify(root.toJSON()), /Workspace: Existing PR workspace/);
    await click("Open workspace"); assert.equal(opened, "existing"); assert.equal(workspaceLists, 1);
    await click("Paseo actions for acme/widget #42"); await click("Terminal"); assert.equal(opened, "existing");
    assert.deepEqual(terminalOptions, { cwd: "/repo/worktree" });
    assert.equal(requests.some(request => request.name.endsWith(".details")), false);
    await click("Paseo actions for acme/widget #42");
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Review with agent/);
    await click("Claude");
    assert.equal(wireOptions.at(-1).config.provider, "claude");
    assert.equal(wireOptions.at(-1).config.model, "first-model");
    await click("Paseo actions for acme/widget #43");
    assert.match(JSON.stringify(root.toJSON()), /No PR workspace/);
    await click("Set up workspace");
    assert.equal(requests.find(request => request.name.endsWith(".details")).input.number, 43);
  } finally { await act(async () => root.unmount()); cache.clear(); }
});
