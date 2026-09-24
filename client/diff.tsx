import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { highlightCode, resolveSyntaxColors, type HighlightToken } from "@getpaseo/highlight";
import { parseDiff, splitDiff } from "./review-state";
import { Control } from "./control";

export function Diff({ patch, path, theme, compact, split, canComment, onComment }: { patch: string; path: string; theme: PluginSurfaceProps["theme"]; compact: boolean; split: boolean; canComment: boolean; onComment(line: number, side: "LEFT" | "RIGHT"): void }) {
  const c = theme.colors, lines = useMemo(() => parseDiff(patch), [patch]);
  const rows = useMemo(() => splitDiff(lines), [lines]);
  const [limit, setLimit] = useState(400);
  const tokens = useMemo(() => {
    const result: HighlightToken[][] = Array.from({ length: lines.length }, () => []);
    let old: number[] = [], current: number[] = [];
    function flush() {
      for (const indices of [old, current]) {
        if (!indices.length) continue;
        const highlighted = highlightCode(indices.map(index => lines[index].text).join("\n"), path);
        indices.forEach((index, offset) => { result[index] = highlighted[offset] ?? []; });
      }
      old = []; current = [];
    }
    lines.forEach((line, index) => {
      if (line.kind === "hunk" || line.kind === "note") { flush(); return; }
      if (line.oldLine !== null) old.push(index);
      if (line.newLine !== null) current.push(index);
    });
    flush();
    return result;
  }, [lines, path]);
  const dark = /^#[0-9a-f]{6}$/i.test(c.surface0) ? Number.parseInt(c.surface0.slice(1, 3), 16) * 0.2126 + Number.parseInt(c.surface0.slice(3, 5), 16) * 0.7152 + Number.parseInt(c.surface0.slice(5, 7), 16) * 0.0722 < 128 : true;
  const palette = useMemo(() => resolveSyntaxColors("github", dark ? "dark" : "light"), [dark]);
  const code = { fontFamily: "monospace", fontSize: 12, lineHeight: 21, color: c.foreground };
  function content(index: number) {
    return tokens[index].length ? tokens[index].map((token, position) => <Text key={position} style={{ color: token.style ? palette[token.style] : c.foreground }}>{token.text}</Text>) : lines[index].text || " ";
  }
  function lineCell(index: number | null, side?: "LEFT" | "RIGHT") {
    if (index === null) return <View style={{ flex: 1, minWidth: split ? 450 : undefined, minHeight: 22 }} />;
    const line = lines[index], color = line.kind === "added" ? c.statusSuccess : line.kind === "removed" ? c.statusDanger : null;
    const targetSide = line.kind === "context" ? "RIGHT" : side ?? (line.newLine === null ? "LEFT" : "RIGHT");
    const number = targetSide === "LEFT" ? line.oldLine : line.newLine;
    return <View style={{ flex: 1, minWidth: split ? 450 : undefined, flexDirection: "row", alignItems: "stretch", minHeight: 22 }}>
      {color && <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: color, opacity: 0.1 }} />}
      <Pressable accessibilityRole="button" accessibilityLabel={`Comment on ${path} ${targetSide === "LEFT" ? "old" : "new"} line ${number}`} disabled={!canComment || number === null} onPress={() => number !== null && onComment(number, targetSide)}
        style={({ pressed }) => ({ flexDirection: "row", backgroundColor: pressed ? c.surface2 : "transparent", paddingRight: 6 })}>
        {!side && <Text style={{ ...code, width: compact ? 34 : 44, textAlign: "right", color: c.foregroundMuted }}>{line.oldLine ?? ""}</Text>}
        <Text style={{ ...code, width: compact ? 34 : 44, textAlign: "right", color: c.foregroundMuted }}>{side === "LEFT" ? line.oldLine ?? "" : line.newLine ?? ""}</Text>
      </Pressable>
      <Text selectable style={{ ...code, width: 18, color: color ?? c.foregroundMuted }}>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</Text>
      <Text selectable style={{ ...code, paddingRight: 16 }}>{content(index)}</Text>
    </View>;
  }
  const count = split ? rows.length : lines.length;
  return <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 5, overflow: "hidden" }}>
    <ScrollView horizontal style={{ backgroundColor: c.surface0 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ minWidth: "100%" }}>{split ? rows.slice(0, limit).map((row, index) => row.header !== null
        ? <View key={index} style={{ minHeight: 22, backgroundColor: c.surface2 }}><Text selectable style={{ ...code, color: c.foregroundMuted, paddingHorizontal: 8 }}>{lines[row.header].text || " "}</Text></View>
        : <View key={index} style={{ flexDirection: "row" }}>{lineCell(row.left, "LEFT")}{lineCell(row.right, "RIGHT")}</View>)
        : lines.slice(0, limit).map((line, index) => line.kind === "hunk" || line.kind === "note"
          ? <View key={index} style={{ minHeight: 22, backgroundColor: line.kind === "hunk" ? c.surface2 : undefined }}><Text selectable style={{ ...code, color: c.foregroundMuted, paddingHorizontal: 8 }}>{line.text || " "}</Text></View>
          : <View key={index}>{lineCell(index)}</View>)}</View>
    </ScrollView>
    {limit < count && <Control theme={theme} compact={compact} label={`Show more lines (${count - limit} remaining)`} onPress={() => setLimit(value => value + 400)} />}
    {canComment && <View style={{ flexDirection: "row", gap: 6, padding: 8, borderTopWidth: 1, borderColor: c.border }}><Icon name="MessageSquarePlus" size={14} color={c.foregroundMuted} /><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Select a line number to comment.</Text></View>}
  </View>;
}
