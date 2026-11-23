import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, elevation, radius } from "@/theme/tokens";
import { AppText } from "./Text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

const ICON_SIZE = { md: 16, lg: 18 } as const;

export function Button({ label, onPress, icon, variant = "primary", size = "md", disabled = false, loading = false, style }: ButtonProps) {
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === "lg" ? styles.large : styles.medium,
        isPrimary && styles.primary,
        variant === "secondary" && styles.secondary,
        isGhost && styles.ghost,
        isPrimary && !disabled && elevation.accent,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={ICON_SIZE[size]}
          color={isPrimary ? colors.ink.inverse : isGhost ? colors.ink.secondary : colors.ink.primary}
        />
      ) : null}
      <AppText variant={size === "lg" ? "bodyLg" : "body"} tone={isPrimary ? "inverse" : "primary"} bold>
        {loading ? "Working…" : label}
      </AppText>
    </Pressable>
  );
}

interface IconButtonProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "danger";
}

export function IconButton({ icon, label, onPress, disabled = false, size = "md", tone = "default" }: IconButtonProps) {
  const dimension = size === "lg" ? 48 : size === "sm" ? 32 : 40;
  const iconSize = size === "lg" ? 22 : size === "sm" ? 14 : 18;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { width: dimension, height: dimension, opacity: disabled ? 0.4 : 1 },
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={iconSize} color={tone === "danger" ? colors.danger[300] : colors.ink.secondary} />
    </Pressable>
  );
}

export function PillButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && styles.pressed]}
    >
      {icon ? <Feather name={icon} size={13} color={active ? colors.gold[200] : colors.ink.tertiary} /> : null}
      <AppText variant="caption" tone={active ? "gold" : "secondary"}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.control,
  },
  medium: { height: 44, paddingHorizontal: 16 },
  large: { height: 52, paddingHorizontal: 22 },
  primary: { backgroundColor: colors.gold[300] },
  secondary: { backgroundColor: colors.surface[3], borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line.strong },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  iconButton: { alignItems: "center", justifyContent: "center", borderRadius: 999 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    backgroundColor: colors.surface[2],
  },
  pillActive: { borderColor: colors.line.accent, backgroundColor: "rgba(196, 146, 62, 0.14)" },
});

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}
