import { marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, type ReactNode } from "react";
import { Image, Linking, Text, View } from "react-native";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { safeLink } from "./review-state";

export function Markdown({ body, theme, baseUrl }: { body: string; theme: PluginSurfaceProps["theme"]; baseUrl: string }) {
  const c = theme.colors, toast = useToast();
  const tokens = useMemo(() => marked.lexer(body, { gfm: true }), [body]);
  const text = { color: c.foreground, fontSize: 14, lineHeight: 23 };
  function open(href: string) { const url = safeLink(href, baseUrl); if (url) void Linking.openURL(url).catch(() => toast.error("Could not open link.")); }
  function inline(items: Token[]): ReactNode {
    return items.map((token, i) => {
      const child = "tokens" in token && token.tokens ? inline(token.tokens ?? []) : "text" in token ? token.text : token.raw;
      switch (token.type) {
        case "strong": return <Text key={i} style={{ fontWeight: "600" }}>{child}</Text>;
        case "em": return <Text key={i} style={{ fontStyle: "italic" }}>{child}</Text>;
        case "del": return <Text key={i} style={{ textDecorationLine: "line-through" }}>{child}</Text>;
        case "codespan": return <Text key={i} style={{ fontFamily: "monospace", fontSize: 12, backgroundColor: c.surface2 }}>{token.text}</Text>;
        case "link": return safeLink(token.href, baseUrl) ? <Text key={i} accessibilityRole="link" onPress={() => open(token.href)} style={{ color: c.accent, textDecorationLine: "underline" }}>{child}</Text> : <Text key={i}>{child}</Text>;
        case "image": return safeLink(token.href, baseUrl) ? <Text key={i} accessibilityRole="link" onPress={() => open(token.href)} style={{ color: c.accent }}>{token.text || "View image"}</Text> : null;
        case "br": return "\n";
        case "html": return null;
        case "escape": case "text": return <Fragment key={i}>{child}</Fragment>;
        default: return <Fragment key={i}>{child}</Fragment>;
      }
    });
  }
  function blocks(items: Token[]): ReactNode {
    return items.map((token, i) => {
      switch (token.type) {
        case "space": return null;
        case "heading": return <Text key={i} accessibilityRole="header" style={{ ...text, fontSize: token.depth < 3 ? 17 : 14, fontWeight: "600", marginTop: i ? 12 : 0 }}>{inline(token.tokens ?? [])}</Text>;
        case "paragraph": case "text": {
          const children = token.tokens ?? [];
          if (children.length === 1 && children[0].type === "image") {
            const image = children[0] as Tokens.Image, uri = safeLink(image.href, baseUrl);
            return uri ? <Image key={i} source={{ uri }} accessibilityLabel={image.text || "PR attachment"} resizeMode="contain" style={{ width: "100%", height: 240 }} /> : null;
          }
          return <Text key={i} selectable style={text}>{children.length ? inline(children) : token.text}</Text>;
        }
        case "code": return <ScrollView horizontal key={i} style={{ backgroundColor: c.surface1, borderRadius: 5 }}><Text selectable style={{ ...text, fontFamily: "monospace", fontSize: 12, lineHeight: 19, padding: 12 }}>{token.text}</Text></ScrollView>;
        case "list": return <View key={i} style={{ gap: 6 }}>{token.items.map((item: Tokens.ListItem, n: number) => <View key={n} style={{ flexDirection: "row", gap: 10 }}><Text style={{ ...text, color: c.foregroundMuted, width: 20 }}>{item.task ? item.checked ? "[x]" : "[ ]" : token.ordered ? `${Number(token.start) + n}.` : "•"}</Text><View style={{ flex: 1, gap: 6 }}>{blocks(item.tokens)}</View></View>)}</View>;
        case "blockquote": return <View key={i} style={{ padding: 12, backgroundColor: c.surface1, gap: 8 }}>{blocks(token.tokens ?? [])}</View>;
        case "hr": return <View key={i} style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />;
        case "table": return <ScrollView key={i} horizontal><View>{[token.header, ...token.rows].map((cells: Tokens.TableCell[], n: number) => <View key={n} style={{ flexDirection: "row", backgroundColor: n ? c.surface0 : c.surface1 }}>{cells.map((cell, j) => <Text key={j} style={{ ...text, fontWeight: n ? "400" : "600", width: 180, padding: 8, borderWidth: 0.5, borderColor: c.border }}>{inline(cell.tokens)}</Text>)}</View>)}</View></ScrollView>;
        case "html": return token.text.trim().startsWith("<!--") ? null : <Text key={i} selectable style={{ ...text, color: c.foregroundMuted }}>{token.text}</Text>;
        default: return <Text key={i} selectable style={text}>{token.raw}</Text>;
      }
    });
  }
  return <View style={{ gap: 10 }}>{blocks(tokens)}</View>;
}
