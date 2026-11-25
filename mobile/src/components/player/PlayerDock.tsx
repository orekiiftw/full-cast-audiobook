import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { AppText, ProgressBar } from "@/components/ui";
import { formatDurationWithHours } from "@/lib/format";
import { selectHaptic } from "@/lib/haptics";
import { usePlayer, usePlayerPosition } from "@/playback/PlayerProvider";
import { colors, elevation, motion, radius } from "@/theme/tokens";

// The collapsed player that sits under the library and the book detail screen while a chapter
// is loaded — the native counterpart of the web client's collapsed transport bar.
//
// It reads the play head from the position store rather than the session, so a tick moves this
// bar and its clock and nothing else in the app. Expanding is choreographed: the bar lifts, and
// the player screen assembles over it, so opening the player reads as one movement.
export function PlayerDock() {
  const router = useRouter();
  const player = usePlayer();
  const { positionMs, ratio } = usePlayerPosition();
  const reduced = useReducedMotion();
  const lift = useSharedValue(0);

  const push = useCallback(() => {
    lift.value = 0;
    router.push("/player");
  }, [lift, router]);

  const open = useCallback(() => {
    selectHaptic();
    if (reduced) {
      router.push("/player");
      return;
    }
    lift.value = withTiming(1, { duration: motion.fast, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(push)();
    });
  }, [lift, push, reduced, router]);

  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.value * 0.03 }, { translateY: -lift.value * 8 }],
    opacity: 1 - lift.value * 0.15,
  }));

  if (!player.activeBook || !player.activeChapter) return null;

  return (
    <Animated.View style={[styles.dock, elevation.e2, dockStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open player: ${player.activeChapter.title}`}
        onPress={open}
        style={styles.pressArea}
      >
        <AppText variant="micro" uppercase tone="goldStrong" numberOfLines={1}>
          {player.activeBook.title}
        </AppText>
        <AppText variant="body" numberOfLines={1}>
          {player.activeChapter.title}
        </AppText>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <ProgressBar ratio={ratio} tone={colors.gold[400]} />
          </View>
          <AppText variant="micro" mono tone="tertiary">
            {formatDurationWithHours(positionMs)}
          </AppText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={player.isPlaying ? "Pause" : "Play"}
        hitSlop={10}
        onPress={player.togglePlayPause}
        style={styles.playButton}
      >
        <Feather name={player.isPlaying ? "pause" : "play"} size={18} color={colors.ink.inverse} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    backgroundColor: colors.surface[2],
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 24,
  },
  pressArea: { flex: 1, gap: 5 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressTrack: { flex: 1 },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold[300],
  },
});
