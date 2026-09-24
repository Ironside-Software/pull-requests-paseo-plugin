import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import type { PluginClientContext } from "@getpaseo/plugin/client";

const openedUrls: string[] = [];
const hooks = registerHooks({
  resolve(specifier, context, next) { return specifier === "react-native" ? { url: "pr-header-test:react-native", shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === "pr-header-test:react-native" ? { source: "export const Linking = { openURL: async url => globalThis.__prHeaderOpen(url) };", format: "module", shortCircuit: true } : next(url, context); },
});
Object.assign(globalThis, { __prHeaderOpen: (url: string) => openedUrls.push(url) });
const { registerPrHeaders } = await import("../client/header");
after(() => hooks.deregister());

const workspace = (id: string) => ({ id, archivingAt: null, gitRuntime: { remoteUrl: "git@github.com:acme/widget.git" }, githubRuntime: { pullRequest: { url: "https://github.com/acme/widget/pull/42" } } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("header buttons cover paginated workspaces, open the right panel, and follow live updates", async () => {
  const registered = new Map<string, any>();
  const observers: any[] = [];
  const opened: unknown[] = [];
  let released = 0, unsubscribed = 0;
  const client = {
    paseo: { workspaces: { list: async ({ page }: any) => {
      const entries = page.cursor ? [workspace("wks_b")] : [workspace("wks_a"), { id: "unsupported", gitRuntime: null }, { ...workspace("unlinked"), githubRuntime: { pullRequest: null } }];
      return { entries, pageInfo: { nextCursor: page.cursor ? null : "next" }, subscription: {
        subscribe(observer: any) { observers.push(observer); observer.snapshot({ entries }); return () => { unsubscribed++; }; },
        release: async () => { released++; },
      } };
    } } },
    addHeaderButton(contribution: any) {
      assert.ok(!registered.has(contribution.workspaceId));
      registered.set(contribution.workspaceId, contribution);
      return { remove: () => registered.delete(contribution.workspaceId), update() {} };
    },
    openPanel: (...args: unknown[]) => opened.push(args),
  } as unknown as PluginClientContext;
  const stop = registerPrHeaders(client);
  await tick();
  assert.deepEqual([...registered.keys()], ["wks_a", "wks_b"]);
  const button = registered.get("wks_b").button;
  assert.equal(button.title, "Open PR in Paseo");
  button.behavior.onPress();
  assert.deepEqual(opened, [["pull-requests", { workspaceId: "wks_b", location: "workspace" }]]);
  observers[0].update({ type: "workspace_update", payload: { kind: "upsert", workspace: workspace("new") } });
  assert.ok(registered.has("new"));
  observers[0].update({ type: "workspace_update", payload: { kind: "upsert", workspace: { ...workspace("new"), githubRuntime: { pullRequest: null } } } });
  assert.ok(!registered.has("new"));
  observers[0].update({ type: "workspace_update", payload: { kind: "upsert", workspace: workspace("new") } });
  observers[0].update({ type: "workspace_update", payload: { kind: "upsert", workspace: { ...workspace("new"), archivingAt: "now" } } });
  assert.ok(!registered.has("new"));
  observers[1].update({ type: "workspace_update", payload: { kind: "remove", id: "wks_b" } });
  assert.ok(!registered.has("wks_b"));
  observers[0].snapshot({ entries: [] });
  assert.equal(registered.size, 0);
  observers[0].update({ type: "workspace_update", payload: { kind: "upsert", workspace: workspace("new") } });
  await stop();
  assert.equal(registered.size, 0);
  assert.equal(released, 2);
  assert.equal(unsubscribed, 2);
  observers[0].snapshot({ entries: [workspace("late")] });
  assert.equal(registered.size, 0);
});

test("cleanup during bootstrap releases the eventual subscription without registering a button", async () => {
  let resolve!: (value: any) => void;
  let released = 0;
  const client = {
    paseo: { workspaces: { list: () => new Promise(accept => { resolve = accept; }) } },
    addHeaderButton() { assert.fail("must not register after cleanup"); },
  } as unknown as PluginClientContext;
  const stop = registerPrHeaders(client);
  const stopping = stop();
  resolve({ subscription: { release: async () => { released++; } } });
  await stopping;
  assert.equal(released, 1);
});

test("preview header button opens the deployment beside the PR button", async () => {
  const registered = new Map<string, any>();
  const client = {
    paseo: { workspaces: { list: async () => ({ entries: [workspace("wks_preview")], pageInfo: {}, subscription: {
      subscribe(observer: any) { observer.snapshot({ entries: [workspace("wks_preview")] }); return () => {}; }, release: async () => {},
    } }) } },
    rpc: async (contract: any) => {
      assert.equal(contract.name, "pull-requests.preview-for-pr");
      return { url: "https://preview.example.test/", environment: "Preview" };
    },
    addHeaderButton(contribution: any) {
      registered.set(contribution.id, contribution);
      return { remove: () => registered.delete(contribution.id), update: (patch: any) => { contribution.button = { ...contribution.button, ...patch }; } };
    },
  } as unknown as PluginClientContext;
  const stop = registerPrHeaders(client);
  await tick();
  assert.equal(registered.size, 2);
  const preview = [...registered.values()].find(entry => entry.button.label === "Preview");
  assert.ok(preview);
  await preview.button.behavior.onPress();
  assert.deepEqual(openedUrls, ["https://preview.example.test/"]);
  await stop();
  assert.equal(registered.size, 0);
});

test("header preview checks are bounded and refresh without workspace updates", async () => {
  const entries = Array.from({ length: 9 }, (_, index) => workspace(`wks_${index}`));
  const pending: (() => void)[] = [];
  const originalNow = Date.now, originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  let now = originalNow(), interval!: () => void, active = 0, peak = 0, calls = 0;
  Date.now = () => now;
  globalThis.setInterval = ((callback: () => void) => { interval = callback; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  const client = {
    paseo: { workspaces: { list: async () => ({ entries, pageInfo: {}, subscription: {
      subscribe(observer: any) { observer.snapshot({ entries }); return () => {}; }, release: async () => {},
    } }) } },
    rpc: async (contract: any) => {
      assert.equal(contract.name, "pull-requests.preview-for-pr");
      calls++; active++; peak = Math.max(peak, active);
      return new Promise(resolve => pending.push(() => { active--; resolve({ url: null, environment: null }); }));
    },
    addHeaderButton: () => ({ remove() {}, update() {} }),
  } as unknown as PluginClientContext;
  const stop = registerPrHeaders(client);
  try {
    await tick();
    assert.equal(calls, 4);
    pending.shift()!(); await tick();
    assert.equal(calls, 5);
    while (pending.length) { pending.shift()!(); await tick(); }
    assert.equal(calls, entries.length);
    now += 60_000;
    interval(); await tick();
    assert.equal(calls, entries.length + 4);
    assert.equal(peak, 4);
    while (pending.length) { pending.shift()!(); await tick(); }
  } finally {
    await stop();
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
