import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Chapter } from "@/api/types";
import { AppText, Badge, Button, CoverArt, Notice, Screen, SkeletonBlock } from "@/components/ui";
import { FadeUp } from "@/components/ui/motion";
import { StagingPanel } from "@/components/staging/StagingPanel";
import { formatCount } from "@/lib/format";
import { tapHaptic } from "@/lib/haptics";
import { stagingFromDetail } from "@/lib/addStage";
import { findLiveChapter, isBookWorking } from "@/playback/detailsData";
import type { BookDetailModel } from "@/hooks/useBookDetail";
import { colors, radius } from "@/theme/tokens";
import { bookStatusOf } from "../library/bookStatus";
import { ChapterRow } from "./ChapterRow";

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
  const staging = useMemo(() => stagingFromDetail(state), [state]);

  if (loading) {
    return (
      <Screen>
        <BackLink onBack={onBack} />
        <View style={styles.hero}>
          <SkeletonBlock style={styles.skeletonCover} borderRadius={radius.control} />
          <View style={styles.heroCopy}>
            <SkeletonBlock style={{ width: 80, height: 20, borderRadius: 999 }} />
            <SkeletonBlock style={{ width: "90%", height: 24 }} />
            <SkeletonBlock style={{ width: "60%", height: 16 }} />
            <SkeletonBlock style={{ width: "40%", height: 12 }} />
          </View>
        </View>
        <SkeletonBlock style={{ width: "100%", height: 148, borderRadius: radius.panel }} />
        <View style={styles.chapters}>
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} style={{ width: "100%", height: 68, borderRadius: radius.tile }} />
          ))}
        </View>
      </Screen>
    );
  }

  if (notFound || !book) {
    return (
      <Screen>
        <BackLink onBack={onBack} />
        <Notice
          tone="error"
          title={notFound ? "This book is gone" : "Couldn't load the performance"}
          message={notFound ? "It may have been removed from your library." : (loadError ?? "Could not load this book.")}
        />
        <Button label="Try again" variant="secondary" onPress={() => void detail.reload()} style={styles.retry} />
      </Screen>
    );
  }

  const status = bookStatusOf(book.status);
  const liveChapter = findLiveChapter(chapters, state.segmentProgress, state.data?.playbackState);
  const working = isBookWorking(book);
  const narrator = state.data?.cast.find((member) => member.name.toLowerCase() === "narrator") ?? state.data?.cast[0];
  const resumeMs = liveChapter ? detail.resumeMsFor(liveChapter) : 0;
  const readyChapters = chapters.filter((chapter) => chapter.status === "ready").length;

  const play = (chapter: Chapter) => {
    tapHaptic();
    onPlayChapter(chapter);
  };

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

      <View style={styles.actions}>
        {liveChapter ? (
          <Button
            label={resumeMs > 0 ? `Continue · ${liveChapter.title}` : `Play · ${liveChapter.title}`}
            icon="play"
            size="lg"
            onPress={() => play(liveChapter)}
            style={styles.flexButton}
          />
        ) : (
          <Button label="Waiting for the first lines" icon="clock" size="lg" disabled onPress={() => undefined} style={styles.flexButton} />
        )}
        <Button label="Delete" variant="ghost" icon="trash-2" onPress={onDelete} />
      </View>

      {working || book.status === "failed" ? (
        <StagingPanel
          staging={staging}
          onRetry={() => void detail.retry()}
          retrying={detail.retrying}
          maxLogLines={8}
          style={styles.console}
        />
      ) : null}

      <View style={styles.chapterHeader}>
        <AppText variant="titleLg">Chapters</AppText>
        <AppText variant="caption" tone="tertiary">
          {readyChapters} of {chapters.length} fully voiced
        </AppText>
      </View>

      <View style={styles.chapters}>
        {chapters.map((chapter, index) => (
          <FadeUp key={chapter.id} index={index} step={35}>
            <ChapterRow
              chapter={chapter}
              progress={state.segmentProgress[chapter.id]}
              isActive={chapter.id === activeChapterId}
              onSelect={play}
            />
          </FadeUp>
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
  retry: { marginTop: 12 },
  hero: { flexDirection: "row", gap: 16, marginBottom: 20 },
  heroCopy: { flex: 1, gap: 8, justifyContent: "center" },
  title: { fontSize: 26, lineHeight: 30 },
  metaList: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  skeletonCover: { width: 124, height: 186 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  flexButton: { flexGrow: 1 },
  console: { marginBottom: 24 },
  chapterHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  chapters: { gap: 8 },
});
