import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerPrHeaders } from "../client/header";

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
