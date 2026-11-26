import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText, Eyebrow } from "@/components/ui";
import {
  PERF_MARK_LIMIT,
  perfEnabled,
  perfFormat,
  perfMark,
  perfMarks,
  perfReset,
  perfSpan,
  sampleFrames,
  type FrameSummary,
} from "@/lib/perf";
import { colors, radius } from "@/theme/tokens";

// The measurement harness, on screen. It exists only when `perfEnabled()` — a dev build, or an
// export built with `EXPO_PUBLIC_PERF_HUD=1` — and it stays a near-invisible dot in the corner
// until someone long-presses it, so a demo build never shows a debug panel by accident.
//
// When it is enabled it also publishes `window.__narrateaPerf`, which is how the before/after
// harness reads the same numbers out of a headless browser instead of photographing them.
export const PERF_BRIDGE_KEY = "__narrateaPerf";

const SPANS: { label: string; from: string; to: string }[] = [
  { label: "detail · open → hero (seeded)", from: "detail:open", to: "detail:seeded" },
  { label: "detail · open → hero (fetched)", from: "detail:open", to: "detail:hero-fetched" },
  { label: "detail · open → chapters", from: "detail:open", to: "detail:painted" },
  { label: "detail · open → fetch landed", from: "detail:open", to: "detail:fetch-landed" },
  { label: "library · mount → list painted", from: "library:open", to: "library:painted" },
  { label: "player · open → assembled", from: "player:open", to: "player:shown" },
];

export function PerfHud() {
  // `PERF_HUD=open` starts with the panel up: the harness reads its numbers straight off the
  // screen instead of driving a long-press it cannot reproduce.
  const [open, setOpen] = useState(() => process.env.EXPO_PUBLIC_PERF_HUD === "open");
  const [summary, setSummary] = useState<FrameSummary | null>(null);
  const [tick, setTick] = useState(0);
  const enabled = perfEnabled();

  useEffect(() => {
    if (!enabled) return;
    const bridge = { marks: perfMarks, span: perfSpan, sample: sampleFrames, format: perfFormat, reset: perfReset, mark: perfMark };
    (globalThis as Record<string, unknown>)[PERF_BRIDGE_KEY] = bridge;
    return () => {
      delete (globalThis as Record<string, unknown>)[PERF_BRIDGE_KEY];
    };
  }, [enabled]);

  // The panel refreshes itself while it is open; nothing ticks while it is closed.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick((value) => value + 1), 600);
    return () => clearInterval(timer);
  }, [open]);

  if (!enabled) return null;

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Performance panel"
        delayLongPress={500}
        onLongPress={() => setOpen(true)}
        style={styles.trigger}
      />
    );
  }

  const marks = perfMarks().slice(-12).reverse();

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <SafeAreaView style={styles.panel} edges={["bottom"]}>
        <View style={styles.head}>
          <Eyebrow>
            Perf · marks {perfMarks().length}/{PERF_MARK_LIMIT}
          </Eyebrow>
          <View style={styles.headActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sample frames"
              onPress={() => {
                void sampleFrames(2000).then(setSummary);
              }}
              style={styles.action}
            >
              <AppText variant="micro" uppercase tone="gold">
                Sample 2s
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Reset marks" onPress={() => perfReset()} style={styles.action}>
              <AppText variant="micro" uppercase tone="tertiary">
                Reset
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close performance panel"
              onPress={() => setOpen(false)}
              style={styles.action}
            >
              <AppText variant="micro" uppercase tone="tertiary">
                Close
              </AppText>
            </Pressable>
          </View>
        </View>

        <View style={styles.spans}>
          {SPANS.map((span) => (
            <View key={span.label} style={styles.row}>
              <AppText variant="micro" tone="secondary" numberOfLines={1}>
                {span.label}
              </AppText>
              <AppText variant="micro" mono tone="gold">
                {perfFormat(perfSpan(span.from, span.to))}
              </AppText>
            </View>
          ))}
          {summary ? (
            <View style={styles.row}>
              <AppText variant="micro" tone="secondary">
                frames
              </AppText>
              <AppText variant="micro" mono tone="gold">
                {summary.fps}fps · {summary.dropped} dropped · worst {summary.worstMs}ms
              </AppText>
            </View>
          ) : null}
        </View>

        <ScrollView style={styles.marks} contentContainerStyle={styles.marksContent}>
          {marks.map((mark, index) => (
            <View key={`${mark.name}-${mark.at}-${index}`} style={styles.row}>
              <AppText variant="micro" tone="tertiary" numberOfLines={1}>
                {mark.name}
              </AppText>
              <AppText variant="micro" mono tone="tertiary">
                {mark.at % 100000}
              </AppText>
            </View>
          ))}
          {marks.length === 0 ? (
            <AppText variant="micro" tone="disabled">
              No marks yet — {tick}
            </AppText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    opacity: 0.08,
    backgroundColor: colors.gold[300],
    borderTopLeftRadius: 34,
  },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, justifyContent: "flex-end" },
  panel: {
    maxHeight: 320,
    backgroundColor: "rgba(11, 15, 13, 0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    padding: 14,
    gap: 10,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headActions: { flexDirection: "row", gap: 10 },
  action: { paddingVertical: 4, paddingHorizontal: 6 },
  spans: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  marks: { maxHeight: 150 },
  marksContent: { gap: 3 },
});
