import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Chapter } from "@/api/types";
import { AppText, Badge, LevelMeter, PressableScale, ProgressRing } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { isChapterPlayable } from "@/playback/playbackSelection";
import { colors, radius } from "@/theme/tokens";
import { chapterStatusOf } from "../library/bookStatus";

// Every row is the same height: a two-line title, one line of meta, and a ring of fixed size.
// That is what lets the chapter list hand `getItemLayout` an exact answer, so jumping to
// chapter 40 of 77 is arithmetic instead of a measuring pass.
export const CHAPTER_ROW_HEIGHT = 106;

// Opaque equivalents of the row's tints. The ring's hole is painted with the row colour, so the
// three row surfaces have to be flat colours rather than translucent ones.
const ROW_BACKGROUND = {
  active: "#201f13",
  playable: colors.surface[2],
  waiting: colors.surface[1],
} as const;

interface ChapterRowProps {
  chapter: Chapter;
  progress?: { total: number; done: number };
  isActive: boolean;
  onSelect: (chapter: Chapter) => void;
}

// One chapter: number, title, live status, duration and the ring that fills as the studio works
// through the chapter. Same states and labels as the web client's ChapterRow.
//
// Memoised: the detail screen re-renders on every pipeline event, and only the row whose
// counters moved should follow it.
function ChapterRowBase({ chapter, progress, isActive, onSelect }: ChapterRowProps) {
  const done = progress?.done ?? chapter.voicedCount;
  const total = progress?.total ?? chapter.totalCount;
  const playable = isChapterPlayable(chapter, done);
  const status = chapterStatusOf(chapter.status);
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const generating = chapter.status === "processing" || chapter.status === "partial_ready";
  const background = isActive ? ROW_BACKGROUND.active : playable ? ROW_BACKGROUND.playable : ROW_BACKGROUND.waiting;

  return (
    <PressableScale
      accessibilityLabel={
        playable
          ? `Play chapter ${chapter.chapterIndex}: ${chapter.title}, ${Math.round(ratio * 100)} percent voiced`
          : `Chapter ${chapter.chapterIndex} is not ready, ${Math.round(ratio * 100)} percent voiced`
      }
      accessibilityState={{ disabled: !playable, selected: isActive }}
      disabled={!playable}
      onPress={() => onSelect(chapter)}
      activeScale={0.985}
      style={[
        styles.row,
        { backgroundColor: background },
        isActive ? styles.rowActive : playable ? styles.rowPlayable : styles.rowDisabled,
      ]}
    >
      <AppText variant="caption" mono tone={isActive ? "gold" : "tertiary"} style={styles.index}>
        {chapter.chapterIndex.toString().padStart(2, "0")}
      </AppText>

      <View style={styles.copy}>
        <AppText variant="bodyLg" numberOfLines={2} tone={isActive ? "gold" : playable ? "primary" : "secondary"} style={styles.title}>
          {chapter.title}
        </AppText>
        <View style={styles.meta}>
          {status.label ? <Badge label={status.label} tone={status.tone} /> : null}
          {chapter.durationMs != null ? (
            <AppText variant="caption" tone="tertiary" mono numberOfLines={1}>
              {formatDuration(chapter.durationMs)}
            </AppText>
          ) : null}
          {generating ? (
            <AppText variant="caption" tone="gold" numberOfLines={1} style={styles.grind}>
              {done > 0 ? "Voicing" : "Queued"} · {done}/{total || "?"}
            </AppText>
          ) : chapter.status === "failed" ? (
            <AppText variant="caption" tone="danger" numberOfLines={1} style={styles.grind}>
              {done}/{total || "?"} lines
            </AppText>
          ) : isActive ? (
            <AppText variant="caption" tone="gold" numberOfLines={1} style={styles.grind}>
              Now playing
            </AppText>
          ) : null}
        </View>
      </View>

      <ProgressRing
        ratio={ratio}
        size={44}
        thickness={3}
        holeColor={background}
        tone={isActive ? colors.gold[300] : generating ? colors.gold[400] : playable ? colors.gold[500] : colors.line.control}
        accessibilityLabel={`${done} of ${total || "unknown"} lines voiced`}
      >
        {isActive ? (
          <LevelMeter height={12} />
        ) : generating ? (
          <AppText variant="micro" mono tone="gold" style={styles.percent}>
            {Math.round(ratio * 100)}
          </AppText>
        ) : (
          <Feather
            name={playable ? "play" : chapter.status === "failed" ? "alert-triangle" : "clock"}
            size={14}
            color={playable ? colors.gold[300] : chapter.status === "failed" ? colors.danger[300] : colors.ink.disabled}
          />
        )}
      </ProgressRing>
    </PressableScale>
  );
}

export const ChapterRow = memo(ChapterRowBase);
ChapterRow.displayName = "ChapterRow";

const styles = StyleSheet.create({
  row: {
    height: CHAPTER_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowActive: { borderColor: colors.line.accent },
  rowPlayable: { borderColor: colors.line.hairline },
  rowDisabled: { borderColor: colors.line.hairline },
  index: { width: 20, alignSelf: "flex-start", marginTop: 3 },
  copy: { flex: 1, gap: 5 },
  title: { lineHeight: 26 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden" },
  grind: { flexShrink: 1 },
  percent: { letterSpacing: 0, fontSize: 10 },
});
