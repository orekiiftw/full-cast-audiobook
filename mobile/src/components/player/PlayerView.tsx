import { useCallback, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { AppText, Button, Eyebrow, IconButton, Screen, Spinner } from "@/components/ui";
import { tapHaptic } from "@/lib/haptics";
import { usePlayer } from "@/playback/PlayerProvider";
import { perfMark } from "@/lib/perf";
import { findNextIndex, findPrevIndex, hasPendingLines } from "@/playback/playbackMath";
import { colors, elevation, motion, radius } from "@/theme/tokens";
import { PlaybackSettings } from "./PlaybackSettings";
import { Scrubber } from "./Scrubber";
import { TranscriptList } from "./TranscriptList";
import { TransportControls } from "./TransportControls";

// The listening screen: header, scrubber, follow-along transcript, transport and settings.
// Everything it renders comes from the app-wide player session, so closing this screen keeps
// the audio running and the dock on the library/detail screens takes over.
//
// Opening and closing are choreographed as one movement with the dock: the chrome rises into
// place on the way in and sinks back on the way out, driven by one shared progress value with a
// staggered delay per block. Collapsing waits for that movement before it returns to the
// previous screen.
export function PlayerView() {
  const router = useRouter();
  const player = usePlayer();
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);

  const { activeBook, activeChapter, segments, currentIndex, isPlaying } = player;

  useEffect(() => {
    perfMark("player:open");
    if (reduced) {
      enter.value = 1;
      perfMark("player:shown");
      return;
    }
    // Short on purpose: the screen must feel like it opened, not like it is opening. The dock's
    // lift runs before this, so the whole movement is ~380ms.
    enter.value = withTiming(1, { duration: motion.enter - 80, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(markPlayerShown)();
    });
  }, [enter, reduced]);

  // Header and transport move together but not identically: the header leads, the controls
  // follow, which is what makes the screen feel assembled rather than faded in.
  const headerStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 22 }],
  }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 40 }],
  }));

  const leave = useCallback(() => {
    tapHaptic();
    if (reduced) {
      router.back();
      return;
    }
    enter.value = withTiming(0, { duration: motion.base, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(router.back)();
    });
  }, [enter, reduced, router]);

  if (!activeBook || !activeChapter) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Feather name="headphones" size={24} color={colors.gold[300]} />
          <AppText variant="titleMd" center>
            Nothing is playing yet
          </AppText>
          <AppText variant="body" tone="secondary" center>
            Open a book and start a chapter.
          </AppText>
          <Button label="Back to library" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const canGoPrev = findPrevIndex(segments, currentIndex) >= 0;
  const canGoNext = findNextIndex(segments, currentIndex) >= 0 || hasPendingLines(segments);

  return (
    <Screen scroll={false}>
      <Animated.View style={[styles.header, headerStyle]}>
        <View style={styles.headerCopy}>
          <Eyebrow numberOfLines={1}>{activeBook.title}</Eyebrow>
          <AppText variant="titleLg" numberOfLines={2}>
            {activeChapter.title}
          </AppText>
          <View style={styles.statusRow}>
            {player.isBufferingNext ? (
              <>
                <Spinner size={11} />
                <AppText variant="caption" tone="gold">
                  Performing next line…
                </AppText>
              </>
            ) : null}
          </View>
        </View>
        <IndexBadge index={currentIndex + 1} total={segments.length} />
        <IconButton icon="chevron-down" label="Collapse player" onPress={leave} />
      </Animated.View>

      <View style={styles.positionBlock}>
        <Scrubber />
      </View>

      <View style={styles.transcript}>
        <TranscriptList segments={segments} currentIndex={currentIndex} onSelect={player.goToSegment} />
      </View>

      <Animated.View style={[styles.controls, controlsStyle]}>
        <TransportControls
          isPlaying={isPlaying}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onTogglePlayPause={player.togglePlayPause}
          onPrev={player.goToPrev}
          onNext={player.goToNext}
        />
        <PlaybackSettings
          playbackSpeed={player.playbackSpeed}
          sleep={player.sleep}
          onSpeedChange={player.setSpeed}
          onSleepChange={player.setSleepPreset}
        />
      </Animated.View>
    </Screen>
  );
}

// The assembly time the harness reads: the moment the player's chrome finished arriving.
function markPlayerShown() {
  perfMark("player:shown");
}

function IndexBadge({ index, total }: { index: number; total: number }) {
  return (
    <View style={styles.indexBadge}>
      <AppText variant="caption" mono tone="secondary">
        {index}/{total || "?"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 12 },
  headerCopy: { flex: 1, gap: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, height: 18 },
  indexBadge: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  positionBlock: { marginTop: 10 },
  transcript: { flex: 1, marginTop: 6, marginBottom: 10 },
  controls: { gap: 18, paddingBottom: 12, ...elevation.e1, borderRadius: radius.panel },
});
