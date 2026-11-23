import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Chapter } from "@/api/types";
import { AppText, Badge, Button, CoverArt, Eyebrow, LevelMeter, Notice, Screen, Spinner } from "@/components/ui";
import { formatCount } from "@/lib/format";
import { findLiveChapter, isBookWorking } from "@/playback/detailsData";
import type { BookDetailModel } from "@/hooks/useBookDetail";
import { colors, radius } from "@/theme/tokens";
import { bookStatusOf } from "../library/bookStatus";
import { ChapterRow } from "./ChapterRow";

const WORKING_NOTES: Record<string, string> = {
  discovering: "Finding a DRM-free copy and reading its chapters.",
  casting: "Casting the narrator and preparing the first chapter.",
  in_progress: "Performing chapter by chapter. You can listen as lines finish.",
};

interface BookDetailViewProps {
  detail: BookDetailModel;
  activeChapterId: string | null;
  onBack: () => void;
  onPlayChapter: (chapter: Chapter) => void;
  onDelete: () => void;
  dock?: React.ReactNode;
}

export function BookDetailView({ detail, activeChapterId, onBack, onPlayChapter, onDelete, dock }: BookDetailViewProps) {
  const { book, chapters, loading, loadError, notFound, state } = detail;

  if (loading) {
    return (
      <Screen>
        <BackLink onBack={onBack} />
        <View style={styles.center}>
          <Spinner size={24} />
          <AppText variant="caption" tone="tertiary">
            Loading the performance…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (notFound || !book) {
    return (
      <Screen>
        <BackLink onBack={onBack} />
        <Notice tone="error" message={notFound ? "This book may have been removed." : (loadError ?? "Could not load this book.")} />
        <Button label="Try again" variant="secondary" onPress={() => void detail.reload()} style={styles.retry} />
      </Screen>
    );
  }

  const status = bookStatusOf(book.status);
  const liveChapter = findLiveChapter(chapters, state.segmentProgress, state.data?.playbackState);
  const working = isBookWorking(book);
  const narrator = state.data?.cast.find((member) => member.name.toLowerCase() === "narrator") ?? state.data?.cast[0];
  const resumeMs = liveChapter ? detail.resumeMsFor(liveChapter) : 0;
  const log = state.log.slice(0, 6);

  return (
    <Screen>
      <BackLink onBack={onBack} />

      <View style={styles.hero}>
        <CoverArt coverR2Key={book.coverR2Key} title={book.title} width={124} />
        <View style={styles.heroCopy}>
          <Badge label={status.label} tone={status.tone} />
          <AppText variant="displayMd" style={styles.title}>
            {book.title}
          </AppText>
          <AppText variant="titleMd" italic tone="secondary">
            by {book.author.trim() || "Unknown author"}
          </AppText>
          <View style={styles.metaList}>
            <MetaItem icon="book-open" label={formatCount(chapters.length, "chapter")} />
            {narrator ? <MetaItem icon="mic" label={`Voiced by ${narrator.ttsVoiceName}`} /> : null}
            {state.data ? <MetaItem icon="pen-tool" label={formatCount(state.data.pronunciation.length, "pronunciation guide")} /> : null}
          </View>
        </View>
      </View>

      {working ? (
        <View style={styles.workingNote}>
          <LevelMeter height={12} />
          <AppText variant="caption" tone="secondary">
            {WORKING_NOTES[book.status] ?? "Working…"}
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        {liveChapter ? (
          <Button
            label={resumeMs > 0 ? `Continue · ${liveChapter.title}` : `Play · ${liveChapter.title}`}
            icon="play"
            size="lg"
            onPress={() => onPlayChapter(liveChapter)}
            style={styles.flexButton}
          />
        ) : (
          <Button label="Waiting for the first lines" icon="clock" size="lg" disabled onPress={() => undefined} style={styles.flexButton} />
        )}
        {book.status === "failed" ? (
          <Button label="Retry" variant="secondary" icon="refresh-cw" onPress={() => void detail.retry()} loading={detail.retrying} />
        ) : null}
        <Button label="Delete" variant="ghost" icon="trash-2" onPress={onDelete} />
      </View>

      {working && log.length > 0 ? (
        <View style={styles.console}>
          <View style={styles.consoleHead}>
            <Eyebrow>Studio console</Eyebrow>
            <LevelMeter height={10} />
          </View>
          {log.map((entry, index) => (
            <AppText key={entry.id} variant="caption" tone={index === 0 ? "secondary" : "tertiary"} style={styles.consoleLine}>
              {entry.text}
            </AppText>
          ))}
        </View>
      ) : null}

      <View style={styles.chapterHeader}>
        <AppText variant="titleLg">Chapters</AppText>
        <AppText variant="caption" tone="tertiary">
          {chapters.filter((chapter) => chapter.status === "ready").length} of {chapters.length} fully voiced
        </AppText>
      </View>

      <View style={styles.chapters}>
        {chapters.map((chapter) => (
          <ChapterRow
            key={chapter.id}
            chapter={chapter}
            progress={state.segmentProgress[chapter.id]}
            isActive={chapter.id === activeChapterId}
            onSelect={onPlayChapter}
          />
        ))}
      </View>

      {dock}
    </Screen>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return <Button label="Library" variant="ghost" icon="chevron-left" onPress={onBack} style={styles.back} />;
}

function MetaItem({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.metaItem}>
      <Feather name={icon} size={13} color={colors.ink.tertiary} />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: "flex-start", marginTop: 12, marginBottom: 8 },
  center: { alignItems: "center", gap: 12, paddingVertical: 64 },
  retry: { marginTop: 12 },
  hero: { flexDirection: "row", gap: 16, marginBottom: 20 },
  heroCopy: { flex: 1, gap: 8, justifyContent: "center" },
  title: { fontSize: 26, lineHeight: 30 },
  metaList: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  workingNote: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  flexButton: { flexGrow: 1 },
  console: {
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
    backgroundColor: colors.surface[1],
    padding: 14,
    gap: 6,
    marginBottom: 24,
  },
  consoleHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  consoleLine: { fontVariant: ["tabular-nums"] },
  chapterHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  chapters: { gap: 8 },
});
