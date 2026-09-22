import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";

type Props = {
  theme: PluginSurfaceProps["theme"];
  compact: boolean;
  label: string;
  onPress(): void;
  selected?: boolean;
  disabled?: boolean;
  icon?: string;
  role?: "button" | "tab" | "radio";
  expanded?: boolean;
};
export function Control({ theme, compact, label, onPress, selected = false, disabled = false, icon, role = "button", expanded }: Props) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const c = theme.colors, primary = selected && role === "button", tab = role === "tab";
  const color = primary ? c.accentForeground : selected || role === "button" ? c.foreground : c.foregroundMuted;
  return <Pressable accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ selected, disabled }}
    aria-selected={tab ? selected : undefined} aria-checked={role === "radio" ? selected : undefined} aria-expanded={expanded}
    disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} hitSlop={compact ? 4 : undefined}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
      minHeight: compact ? 36 : 30, paddingHorizontal: tab ? 6 : 8, paddingVertical: 4, borderRadius: tab ? 0 : 5,
      borderWidth: tab ? 0 : 1, borderColor: focused ? c.accent : "transparent", borderBottomWidth: tab ? 2 : 1, borderBottomColor: selected || focused ? c.accent : "transparent",
      backgroundColor: primary ? c.accent : pressed || hovered || (selected && !tab) ? c.surface2 : "transparent", opacity: disabled ? 0.45 : 1 })}>
    {(icon || role === "radio") && <Icon name={icon ?? (selected ? "CircleDot" : "Circle")} size={14} color={color} />}
    <Text style={{ color, fontSize: tab && compact ? 12 : 13, lineHeight: 18, flexShrink: 1, fontWeight: selected ? "600" : "400" }}>{label}</Text>
    {expanded !== undefined && <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={12} color={color} />}
  </Pressable>;
}
