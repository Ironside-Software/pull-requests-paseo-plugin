import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { parseDiff } from "./review-state";
import { Control } from "./control";

export function Diff({ patch, path, theme, compact, canComment, onComment }: { patch: string; path: string; theme: PluginSurfaceProps["theme"]; compact: boolean; canComment: boolean; onComment(line: number, side: "LEFT" | "RIGHT"): void }) {
  const c = theme.colors, lines = useMemo(() => parseDiff(patch), [patch]);
  const [limit, setLimit] = useState(400);
  const code = { fontFamily: "monospace", fontSize: 12, lineHeight: 21, color: c.foreground };
  return <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 5, overflow: "hidden" }}>
    <ScrollView horizontal style={{ backgroundColor: c.surface0 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ minWidth: "100%" }}>{lines.slice(0, limit).map((line, index) => {
        const color = line.kind === "added" ? c.statusSuccess : line.kind === "removed" ? c.statusDanger : null;
        const number = line.newLine ?? line.oldLine, side = line.newLine === null ? "LEFT" : "RIGHT";
        return <View key={index} style={{ flexDirection: "row", alignItems: "stretch", minHeight: 22, backgroundColor: line.kind === "hunk" ? c.surface2 : undefined }}>
          {color && <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: color, opacity: 0.1 }} />}
          <Pressable accessibilityRole="button" accessibilityLabel={`Comment on ${path} ${side === "LEFT" ? "old" : "new"} line ${number}`} disabled={!canComment || number === null} onPress={() => number && onComment(number, side)}
            style={({ pressed }) => ({ flexDirection: "row", backgroundColor: pressed ? c.surface2 : "transparent", paddingRight: 6 })}>
            <Text style={{ ...code, width: compact ? 34 : 44, textAlign: "right", color: c.foregroundMuted }}>{line.oldLine ?? ""}</Text>
            <Text style={{ ...code, width: compact ? 34 : 44, textAlign: "right", color: c.foregroundMuted }}>{line.newLine ?? ""}</Text>
          </Pressable>
          <Text selectable style={{ ...code, width: 18, color: color ?? c.foregroundMuted }}>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</Text>
          <Text selectable style={{ ...code, color: line.kind === "hunk" ? c.foregroundMuted : c.foreground, paddingRight: 16 }}>{line.text || " "}</Text>
        </View>;
      })}</View>
    </ScrollView>
    {limit < lines.length && <Control theme={theme} compact={compact} label={`Show more lines (${lines.length - limit} remaining)`} onPress={() => setLimit(value => value + 400)} />}
    {canComment && <View style={{ flexDirection: "row", gap: 6, padding: 8, borderTopWidth: 1, borderColor: c.border }}><Icon name="MessageSquarePlus" size={14} color={c.foregroundMuted} /><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Select a line number to comment.</Text></View>}
  </View>;
}
