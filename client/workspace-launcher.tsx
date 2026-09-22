import { usePaseo, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Control } from "./control";
import { matchingWorkspaces, selectWorkspace, type PaseoWorkspace } from "./integration";
import type { PrKey } from "../shared/details";

type LauncherProps = PluginSurfaceProps & {
  workspace: PaseoWorkspace;
  number: number;
  disabled?: boolean;
  expanded?: boolean;
  onLaunched?(): void;
  onBusyChange?(busy: boolean): void;
};

export function WorkspaceLauncher({ workspace, number, theme, layout, host, navigation, disabled, onBusyChange, expanded = false, onLaunched }: LauncherProps) {
  const paseo = usePaseo();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false);
  const providers = useQuery({
    queryKey: ["pr-providers", host.id], queryFn: () => paseo.providers.waitForReady({ timeoutMs: 15000 }),
    enabled: (open || expanded) && !!navigation, staleTime: 60_000, retry: false,
  });
  const ready = (providers.data?.entries.filter(provider => provider.enabled && provider.status === "ready") ?? []).map(provider => {
    const models = (provider.models ?? []).filter(model => model.isSelectable !== false && model.id);
    const model = models.find(model => model.isDefault) ?? models[0];
    return { ...provider, selection: model ? `${provider.provider}/${model.id}` : null };
  });
  const c = theme.colors;
  async function launch(provider?: string) {
    if (!navigation || disabled || working.current) return;
    const selection = ready.find(entry => entry.provider === provider)?.selection;
    if (provider && (providers.error || !selection)) return;
    working.current = true; setBusy(true); onBusyChange?.(true); setError("");
    try {
      const target = paseo.workspaces.ref(workspace);
      if (provider) {
        const agent = await target.agents.create({ config: { provider: selection! }, title: `PR #${number}` });
        navigation.openAgent({ agentId: agent.id, serverId: host.id });
      } else {
        await target.terminals.create({ cwd: workspace.workspaceDirectory });
        navigation.openWorkspace({ workspaceId: target.id, serverId: host.id });
      }
      setOpen(false); onLaunched?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Paseo could not launch in this workspace.");
    } finally { working.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <View style={{ gap: 8 }}>
    {!expanded && <View style={{ alignItems: "flex-start" }}>
      <Control theme={theme} compact={layout.compact} label={busy ? "Opening…" : "Open…"} icon="Plus" expanded={open} onPress={() => setOpen(value => !value)} disabled={disabled || busy} />
    </View>}
    {(open || expanded) && <View style={{ gap: 8, padding: expanded ? 0 : 12, backgroundColor: expanded ? "transparent" : c.surface1, borderRadius: 5 }}>
      {!expanded && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Open in {workspace.name}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Control theme={theme} compact={layout.compact} label="Terminal" icon="Terminal" onPress={() => void launch()} disabled={disabled || busy} />
        {ready.map(provider => <Control key={provider.provider} theme={theme} compact={layout.compact} label={provider.label ?? provider.provider} icon="Bot" onPress={() => void launch(provider.provider)} disabled={disabled || busy || !!providers.error || !provider.selection} />)}
      </View>
      {ready.some(provider => !provider.selection) && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Providers without an available model are disabled.</Text>}
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Terminal opens the workspace; select its terminal tab there.</Text>
      {providers.isPending && <Text style={{ color: c.foregroundMuted }}>Loading agents…</Text>}
      {providers.error && <View style={{ gap: 4 }}>
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>Agents could not be loaded.</Text>
        <Control theme={theme} compact={layout.compact} label="Retry agents" onPress={() => void providers.refetch()} disabled={providers.isFetching} />
      </View>}
      {!providers.isPending && !providers.error && !ready.length && <Text style={{ color: c.foregroundMuted }}>Configure an agent provider in Paseo to add agent options.</Text>}
    </View>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{error}</Text>}
  </View>;
}

export function PrWorkspaceActions(props: PluginSurfaceProps & { pr: PrKey; workspaces: PaseoWorkspace[]; workspaceId?: string; onSetup(): void }) {
  const matches = matchingWorkspaces(props.workspaces, props.pr);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(""), [busy, setBusy] = useState(false);
  const selected = selectWorkspace(matches, props.workspaceId, selectedId);
  const { theme, layout, navigation, host } = props;
  const c = theme.colors;
  if (!navigation) return null;
  return <>
    <Control theme={theme} compact={layout.compact} label="Paseo" accessibilityLabel={`Paseo actions for ${props.pr.repository} #${props.pr.number}`}
      icon={matches.length ? "FolderGit2" : "Ellipsis"} expanded={open} onPress={() => setOpen(true)} />
    <Modal title={`Paseo · ${props.pr.repository} #${props.pr.number}`} open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <Modal.Content contentContainerStyle={{ padding: 18, gap: 12 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{selected ? `Workspace: ${selected.name}` : matches.length ? `${matches.length} PR workspaces` : "No PR workspace"}</Text>
        {matches.length > 1 && <View accessibilityRole="radiogroup" accessibilityLabel="PR workspace" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {matches.map(workspace => <Control key={workspace.id} theme={theme} compact={layout.compact} label={workspace.name} selected={selected?.id === workspace.id} role="radio" disabled={busy} onPress={() => setSelectedId(workspace.id)} />)}
        </View>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {!matches.length
            ? <Control theme={theme} compact={layout.compact} label="Set up workspace" icon="FolderGit2" onPress={() => { setOpen(false); props.onSetup(); }} />
            : <Control theme={theme} compact={layout.compact} label="Open workspace" icon="FolderGit2" disabled={!selected || busy} onPress={() => { if (selected) { setOpen(false); navigation.openWorkspace({ workspaceId: selected.id, serverId: host.id }); } }} />}
        </View>
        {selected && <WorkspaceLauncher {...props} key={selected.id} workspace={selected} number={props.pr.number} expanded onLaunched={() => setOpen(false)} onBusyChange={setBusy} />}
      </Modal.Content>
    </Modal>
  </>;
}
