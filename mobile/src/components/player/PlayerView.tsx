import { useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AppText, Button, Eyebrow, IconButton, ProgressBar, Screen, Spinner } from "@/components/ui";
import { formatDurationWithHours } from "@/lib/format";
import { usePlayer } from "@/playback/PlayerProvider";
import { findNextIndex, findPrevIndex, hasPendingLines } from "@/playback/playbackMath";
import { colors, elevation, radius } from "@/theme/tokens";
import { PlaybackSettings } from "./PlaybackSettings";
import { TranscriptList } from "./TranscriptList";
import { TransportControls } from "./TransportControls";

// The listening screen: header, position, follow-along transcript, transport and settings.
// Everything it renders comes from the app-wide player session, so closing this screen keeps
// the audio running and the dock on the library/detail screens takes over.
export function PlayerView() {
  const router = useRouter();
  const player = usePlayer();
  const [trackWidth, setTrackWidth] = useState(0);

  const { activeBook, activeChapter, segments, currentIndex, isPlaying, chapterTotalMs, positionMs } = player;

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

  const seek = (event: { nativeEvent: { locationX: number } }) => {
    if (trackWidth <= 0) return;
    player.seekToRatio(Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth)));
  };

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
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
        <IconButton icon="chevron-down" label="Collapse player" onPress={() => router.back()} />
      </View>

      <View style={styles.positionBlock}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Seek within the chapter"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(chapterTotalMs > 0 ? (positionMs / chapterTotalMs) * 100 : 0) }}
          onPress={seek}
          onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
          style={styles.trackHit}
        >
          <ProgressBar ratio={chapterTotalMs > 0 ? positionMs / chapterTotalMs : 0} />
        </Pressable>
        <View style={styles.timeRow}>
          <AppText variant="caption" tone="tertiary" mono>
            {formatDurationWithHours(positionMs)}
          </AppText>
          <AppText variant="caption" tone="tertiary" mono>
            {formatDurationWithHours(chapterTotalMs)}
          </AppText>
        </View>
      </View>

      <View style={styles.transcript}>
        <TranscriptList segments={segments} currentIndex={currentIndex} onSelect={player.goToSegment} />
      </View>

      <View style={styles.controls}>
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
      </View>
    </Screen>
  );
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
  positionBlock: { marginTop: 14, gap: 6 },
  trackHit: { paddingVertical: 10 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  transcript: { flex: 1, marginTop: 6, marginBottom: 10 },
  controls: { gap: 18, paddingBottom: 12, ...elevation.e1, borderRadius: radius.panel },
});
