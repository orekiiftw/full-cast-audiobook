import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius } from "@/theme/tokens";
import { AppText } from "./Text";

export function Spinner({ size = 16, color = colors.gold[300] }: { size?: number; color?: string }) {
  return <ActivityIndicator size={size > 20 ? "large" : "small"} color={color} />;
}

export type BadgeTone = "gold" | "emerald" | "red" | "cyan" | "purple" | "neutral";

const badgeColors: Record<BadgeTone, { border: string; text: string; background: string }> = {
  gold: { border: "rgba(227, 197, 135, 0.45)", text: colors.gold[200], background: "rgba(196, 146, 62, 0.16)" },
  emerald: { border: "rgba(143, 211, 174, 0.4)", text: colors.success[300], background: "rgba(63, 165, 114, 0.14)" },
  red: { border: "rgba(244, 151, 139, 0.4)", text: colors.danger[300], background: "rgba(217, 80, 63, 0.14)" },
  cyan: { border: "rgba(156, 195, 230, 0.4)", text: colors.info[300], background: "rgba(76, 134, 189, 0.14)" },
  purple: { border: "rgba(179, 189, 217, 0.4)", text: colors.studio[300], background: "rgba(111, 125, 166, 0.18)" },
  neutral: { border: colors.line.strong, text: colors.ink.tertiary, background: colors.surface[2] },
};

export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  const palette = badgeColors[tone];
  return (
    <View style={[styles.badge, { borderColor: palette.border, backgroundColor: palette.background }]}>
      <AppText variant="micro" uppercase style={{ color: palette.text, fontSize: 10, letterSpacing: 1.2 }}>
        {label}
      </AppText>
    </View>
  );
}

// Three bars that pulse while a chapter is being voiced — the web client's LevelMeter.
export function LevelMeter({ bars = 3, height = 14 }: { bars?: number; height?: number }) {
  return (
    <View style={[styles.meter, { height }]} accessibilityLabel="Working">
      {Array.from({ length: bars }).map((_, index) => (
        <View key={index} style={[styles.meterBar, { height: height * (0.45 + (index % 3) * 0.25) }]} />
      ))}
    </View>
  );
}

export function ProgressBar({ ratio, tone = colors.gold[400] }: { ratio: number; tone?: string }) {
  const width = Math.max(0, Math.min(1, ratio));
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: width * 100 }}>
      <View style={[styles.fill, { backgroundColor: tone, width: `${width * 100}%` }]} />
    </View>
  );
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  meter: { flexDirection: "row", alignItems: "center", gap: 3 },
  meterBar: { width: 3, borderRadius: 2, backgroundColor: colors.gold[300] },
  track: { height: 3, borderRadius: 2, backgroundColor: "rgba(242, 238, 228, 0.08)", overflow: "hidden" },
  fill: { height: 3, borderRadius: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line.hairline, marginVertical: 16 },
});

export { radius };

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

// Two-or-more way switch used for auth modes and filter rows; the active segment is gold.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={segmentedStyles.row}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.id)}
            style={[segmentedStyles.segment, active && segmentedStyles.segmentActive]}
          >
            <AppText variant="caption" tone={active ? "inverse" : "secondary"} bold={active}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const segmentedStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    backgroundColor: colors.surface[2],
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", height: 36, borderRadius: 999 },
  segmentActive: { backgroundColor: colors.gold[300] },
});
