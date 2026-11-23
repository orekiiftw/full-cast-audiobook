import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Chapter } from "@/api/types";
import { AppText, Badge, LevelMeter, ProgressBar } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { isChapterPlayable } from "@/playback/playbackSelection";
import { colors, radius } from "@/theme/tokens";
import { chapterStatusOf } from "../library/bookStatus";

interface ChapterRowProps {
  chapter: Chapter;
  progress?: { total: number; done: number };
  isActive: boolean;
  onSelect: (chapter: Chapter) => void;
}

// One chapter: number, title, live status, duration and the voicing counters that move while
// the studio works through it. Same states and labels as the web client's ChapterRow.
export function ChapterRow({ chapter, progress, isActive, onSelect }: ChapterRowProps) {
  const done = progress?.done ?? chapter.voicedCount;
  const total = progress?.total ?? chapter.totalCount;
  const playable = isChapterPlayable(chapter, done);
  const status = chapterStatusOf(chapter.status);
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const generating = chapter.status === "processing" || chapter.status === "partial_ready";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        playable ? `Play chapter ${chapter.chapterIndex}: ${chapter.title}` : `Chapter ${chapter.chapterIndex} is not ready`
      }
      accessibilityState={{ disabled: !playable, selected: isActive }}
      disabled={!playable}
      onPress={() => onSelect(chapter)}
      style={({ pressed }) => [
        styles.row,
        isActive ? styles.rowActive : playable ? styles.rowPlayable : styles.rowDisabled,
        pressed && { opacity: 0.88 },
      ]}
    >
      <AppText variant="caption" mono tone={isActive ? "gold" : "tertiary"} style={styles.index}>
        {chapter.chapterIndex.toString().padStart(2, "0")}
      </AppText>

      <View style={styles.copy}>
        <AppText variant="bodyLg" numberOfLines={2} tone={isActive ? "gold" : playable ? "primary" : "secondary"}>
          {chapter.title}
        </AppText>
        <View style={styles.meta}>
          {status.label ? <Badge label={status.label} tone={status.tone} /> : null}
          {chapter.durationMs != null ? (
            <AppText variant="caption" tone="tertiary" mono>
              {formatDuration(chapter.durationMs)}
            </AppText>
          ) : null}
          {generating ? (
            <AppText variant="caption" tone="gold">
              {done > 0 ? "Listen live" : "Voicing"} · {done}/{total || "?"} lines
            </AppText>
          ) : chapter.status === "failed" ? (
            <AppText variant="caption" tone="danger">
              {done}/{total || "?"} lines voiced
            </AppText>
          ) : chapter.status === "ready" ? (
            <AppText variant="caption" tone="tertiary">
              {done} lines
            </AppText>
          ) : null}
          {isActive ? (
            <AppText variant="caption" tone="gold">
              Now playing
            </AppText>
          ) : null}
        </View>
        {generating ? <ProgressBar ratio={ratio} /> : null}
      </View>

      <View style={[styles.action, isActive && styles.actionActive, !playable && styles.actionDisabled]}>
        {isActive ? (
          <LevelMeter height={12} />
        ) : (
          <Feather
            name={playable ? "play" : chapter.status === "failed" ? "alert-triangle" : "clock"}
            size={15}
            color={isActive ? colors.ink.inverse : playable ? colors.gold[300] : colors.ink.disabled}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowActive: { borderColor: colors.line.accent, backgroundColor: "rgba(196, 146, 62, 0.12)" },
  rowPlayable: { borderColor: colors.line.hairline, backgroundColor: colors.surface[2] },
  rowDisabled: { borderColor: colors.line.hairline, backgroundColor: colors.surface[1] },
  index: { width: 20, alignSelf: "flex-start", marginTop: 2 },
  copy: { flex: 1, gap: 6 },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  action: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.accent,
  },
  actionActive: { borderColor: "transparent", backgroundColor: colors.gold[300] },
  actionDisabled: { borderColor: colors.line.hairline },
});
