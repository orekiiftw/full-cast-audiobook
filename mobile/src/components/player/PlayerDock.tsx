import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AppText, ProgressBar } from "@/components/ui";
import { usePlayer } from "@/playback/PlayerProvider";
import { colors, elevation, radius } from "@/theme/tokens";

// The collapsed player that sits under the library and the book detail screen while a
// chapter is loaded — the native counterpart of the web client's collapsed transport bar.
export function PlayerDock() {
  const router = useRouter();
  const player = usePlayer();
  if (!player.activeBook || !player.activeChapter) return null;

  const ratio = player.chapterTotalMs > 0 ? player.positionMs / player.chapterTotalMs : 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open player: ${player.activeChapter.title}`}
      onPress={() => router.push("/player")}
      style={({ pressed }) => [styles.dock, elevation.e2, pressed && { opacity: 0.92 }]}
    >
      <View style={styles.copy}>
        <AppText variant="micro" uppercase tone="goldStrong" numberOfLines={1}>
          {player.activeBook.title}
        </AppText>
        <AppText variant="body" numberOfLines={1}>
          {player.activeChapter.title}
        </AppText>
        <ProgressBar ratio={ratio} tone={colors.gold[400]} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={player.isPlaying ? "Pause" : "Play"}
        hitSlop={10}
        onPress={player.togglePlayPause}
        style={styles.playButton}
      >
        <Feather name={player.isPlaying ? "pause" : "play"} size={18} color={colors.ink.inverse} />
      </Pressable>
    </Pressable>
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
  copy: { flex: 1, gap: 5 },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold[300],
  },
});
