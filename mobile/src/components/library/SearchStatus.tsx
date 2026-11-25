import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { AppText, Badge, Spinner } from "@/components/ui";
import { formatElapsed, searchProgressLine, sourceAnswers, type SourceAnswer } from "@/lib/searchClock";
import { colors, radius } from "@/theme/tokens";

// A search against the live server takes 13.3s with every provider healthy, because one of them
// is a torrent sweep. The button spinning for that long reads as a hang, so while the request is
// in flight the sheet shows a moving line, the elapsed time and the sources being asked. When the
// answer lands, the same chips say which sources replied and which are still working.

interface SearchStatusProps {
  startedAt: number | null;
  finishedAt: number | null;
  live: boolean;
  roster: string[] | null;
  pending: string[] | null;
}

const CHIP_HOLD = 200;

export function SearchStatus({ startedAt, finishedAt, live, roster, pending }: SearchStatusProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), CHIP_HOLD);
    return () => clearInterval(timer);
  }, [live]);

  const elapsed = startedAt === null ? 0 : Math.max(0, (live ? now : (finishedAt ?? now)) - startedAt);
  const answers: SourceAnswer[] = live
    ? sourceAnswers(roster, null).map((answer) => ({ ...answer, answered: false }))
    : sourceAnswers(roster, pending);
  const answeredCount = answers.filter((answer) => answer.answered).length;
  const line = live
    ? searchProgressLine(elapsed, 0, answers.length)
    : `${formatElapsed(elapsed)} · ${answeredCount} of ${answers.length} sources in`;

  return (
    <View style={styles.wrapper}>
      <View style={styles.head}>
        {live ? <Spinner size={11} /> : null}
        <AppText variant="caption" tone={live ? "gold" : "secondary"} numberOfLines={1} style={styles.line}>
          {line}
        </AppText>
      </View>

      {live ? <IndeterminateBar /> : null}

      <View style={styles.chips}>
        {answers.map((answer) => (
          <Badge key={answer.provider} label={answer.label} tone={live ? "neutral" : answer.answered ? "emerald" : "gold"} />
        ))}
      </View>
    </View>
  );
}

// The moving line: one shared value sweeping a highlight across a track, entirely on the UI
// thread. With reduce-motion on it is a static rule, which still marks the sheet as busy.
function IndeterminateBar() {
  const reduced = useReducedMotion();
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      sweep.value = 0.35;
      return;
    }
    sweep.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [reduced, sweep]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${28 + sweep.value * 24}%`,
    transform: [{ translateX: `${(sweep.value * 100 - 28) * 1.6}%` }],
  }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.trackFill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
    backgroundColor: colors.surface[1],
    padding: 12,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { flex: 1 },
  track: { height: 3, borderRadius: 2, backgroundColor: "rgba(242, 238, 228, 0.08)", overflow: "hidden" },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: colors.gold[400] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
