import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";
import type { Chapter } from "@/api/types";
import { AppText, Badge, Button, CoverArt, Notice, SkeletonBlock } from "@/components/ui";
import { StagingPanel } from "@/components/staging/StagingPanel";
import { formatCount } from "@/lib/format";
import { tapHaptic } from "@/lib/haptics";
import { isMeasurableFrame, takeCoverFlight, type Frame } from "@/lib/coverFlight";
import { fixedItemLayout } from "@/lib/listLayout";
import { perfMark } from "@/lib/perf";
import { stagingFromDetail } from "@/lib/addStage";
import { findLiveChapter, isBookWorking } from "@/playback/detailsData";
import type { BookDetailModel } from "@/hooks/useBookDetail";
import { colors, radius } from "@/theme/tokens";
import { bookStatusOf } from "../library/bookStatus";
import { ChapterRow, CHAPTER_ROW_HEIGHT } from "./ChapterRow";
import { CoverFlight } from "./CoverFlight";

interface BookDetailViewProps {
  bookId: string;
  detail: BookDetailModel;
  activeChapterId: string | null;
  onBack: () => void;
  onPlayChapter: (chapter: Chapter) => void;
  onDelete: () => void;
  dock?: React.ReactNode;
}

const CHAPTER_GAP = 8;
const CHAPTER_ROWS_LAYOUT = fixedItemLayout(CHAPTER_ROW_HEIGHT, CHAPTER_GAP);
const SKELETON_CHAPTERS = [0, 1, 2, 3, 4, 5];

// The detail screen. It opens from a library row, so it paints that row's title, author, cover
// and status on the first frame — the chapter list arrives as skeletons and is reconciled when
// the 1.2s (warm) to 4.1s (cold) detail fetch lands. The chapter list is virtualised with fixed
// pitch: 77 chapters cost 77 cheap rows that mount only as they scroll, and the pipeline's live
// counters only re-render the row whose numbers moved.
export function BookDetailView({ bookId, detail, activeChapterId, onBack, onPlayChapter, onDelete, dock }: BookDetailViewProps) {
  const { book, chapters, loading, loadError, notFound, state } = detail;
  const staging = useMemo(() => stagingFromDetail(state), [state]);
  const reduced = useReducedMotion();

  // The shared-element hand-off: the library card's cover rectangle, picked up once per mount.
  const pendingOrigin = useRef<Frame | null>(null);
  const claimed = useRef(false);
  const heroCoverRef = useRef<ComponentRef<typeof View> | null>(null);
  const [flight, setFlight] = useState<{ from: Frame; to: Frame } | null>(null);

  useEffect(() => {
    if (claimed.current) return;
    claimed.current = true;
    const origin = reduced ? null : takeCoverFlight(bookId);
    if (origin) pendingOrigin.current = origin;
  }, [bookId, reduced]);

  const handleHeroCoverLayout = useCallback(() => {
    const origin = pendingOrigin.current;
    if (!origin || flight) return;
    heroCoverRef.current?.measureInWindow((x, y, width, height) => {
      const to = { x, y, width, height };
      if (!isMeasurableFrame(to)) {
        pendingOrigin.current = null;
        return;
      }
      pendingOrigin.current = null;
      setFlight({ from: origin, to });
    });
  }, [flight]);

  // The two moments that matter are different: the hero existing at all (from the library row,
  // or only after the fetch), and the payload's chapter list existing.
  const heroMarked = useRef(false);
  useEffect(() => {
    if (!book || heroMarked.current) return;
    heroMarked.current = true;
    perfMark(detail.seed && !detail.state.data ? "detail:seeded" : "detail:hero-fetched");
  }, [book, detail.seed, detail.state.data]);

  useEffect(() => {
    if (!loading) perfMark("detail:painted");
  }, [loading]);

  const renderChapter = useCallback(
    ({ item }: { item: Chapter }) => (
      <ChapterRow
        chapter={item}
        progress={state.segmentProgress[item.id]}
        isActive={item.id === activeChapterId}
        onSelect={onPlayChapter}
      />
    ),
    [activeChapterId, onPlayChapter, state.segmentProgress],
  );

  const hero =
    book && !notFound ? (
      <View>
        <View style={styles.hero}>
          <View ref={heroCoverRef} onLayout={handleHeroCoverLayout} collapsable={false} style={flight ? styles.coverHidden : undefined}>
            <CoverArt coverR2Key={book.coverR2Key} title={book.title} width={124} />
          </View>
          <View style={styles.heroCopy}>
            <Badge label={bookStatusOf(book.status).label} tone={bookStatusOf(book.status).tone} />
            <AppText variant="displayMd" style={styles.title}>
              {book.title}
            </AppText>
            <AppText variant="titleMd" italic tone="secondary">
              by {book.author.trim() || "Unknown author"}
            </AppText>
            <View style={styles.metaList}>
              <MetaItem icon="book-open" label={chapters.length > 0 ? formatCount(chapters.length, "chapter") : "Chapters loading"} />
              {narratorOf(detail) ? <MetaItem icon="mic" label={`Voiced by ${narratorOf(detail)}`} /> : null}
              {state.data ? <MetaItem icon="pen-tool" label={formatCount(state.data.pronunciation.length, "pronunciation guide")} /> : null}
            </View>
          </View>
        </View>

        <Actions detail={detail} chapters={chapters} state={state} onPlay={onPlayChapter} onDelete={onDelete} />

        {isBookWorking(book) || book.status === "failed" ? (
          <StagingPanel
            staging={staging}
            onRetry={() => void detail.retry()}
            retrying={detail.retrying}
            maxLogLines={8}
            style={styles.console}
          />
        ) : null}

        {loadError ? (
          <Notice
            tone="error"
            title="Live updates are behind"
            message={loadError}
            action={{ label: "Retry", onPress: () => void detail.reload() }}
          />
        ) : null}

        <View style={styles.chapterHeader}>
          <AppText variant="titleLg">Chapters</AppText>
          {chapters.length > 0 ? (
            <AppText variant="caption" tone="tertiary">
              {chapters.filter((chapter) => chapter.status === "ready").length} of {chapters.length} fully voiced
            </AppText>
          ) : null}
        </View>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Button label="Library" variant="ghost" icon="chevron-left" onPress={onBack} style={styles.back} />

      {notFound || (!book && !loading) ? (
        <View style={styles.failure}>
          <Notice
            tone="error"
            title={notFound ? "This book is gone" : "Couldn't load the performance"}
            message={notFound ? "It may have been removed from your library." : (loadError ?? "Could not load this book.")}
          />
          <Button label="Try again" variant="secondary" onPress={() => void detail.reload()} style={styles.retry} />
        </View>
      ) : !book ? (
        <LoadingHero />
      ) : (
        <FlatList
          data={chapters}
          keyExtractor={(chapter) => chapter.id}
          renderItem={renderChapter}
          getItemLayout={CHAPTER_ROWS_LAYOUT}
          ItemSeparatorComponent={ChapterGap}
          ListHeaderComponent={hero ?? undefined}
          ListEmptyComponent={loading ? <SkeletonChapters /> : undefined}
          ListFooterComponent={dock ? <View style={styles.footer}>{dock}</View> : undefined}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={40}
          windowSize={7}
        />
      )}

      {flight ? (
        <CoverFlight
          title={book?.title ?? ""}
          coverR2Key={book?.coverR2Key ?? null}
          from={flight.from}
          to={flight.to}
          onDone={() => setFlight(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function narratorOf(detail: BookDetailModel): string | null {
  const cast = detail.state.data?.cast;
  if (!cast || cast.length === 0) return null;
  return (cast.find((member) => member.name.toLowerCase() === "narrator") ?? cast[0]).ttsVoiceName;
}

function Actions({
  detail,
  chapters,
  state,
  onPlay,
  onDelete,
}: {
  detail: BookDetailModel;
  chapters: Chapter[];
  state: BookDetailModel["state"];
  onPlay: (chapter: Chapter) => void;
  onDelete: () => void;
}) {
  const liveChapter = findLiveChapter(chapters, state.segmentProgress, state.data?.playbackState);
  const resumeMs = liveChapter ? detail.resumeMsFor(liveChapter) : 0;

  const play = (chapter: Chapter) => {
    tapHaptic();
    onPlay(chapter);
  };

  return (
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
        <Button
          label={chapters.length > 0 ? "Waiting for the first lines" : "Loading chapters"}
          icon="clock"
          size="lg"
          disabled
          onPress={() => undefined}
          style={styles.flexButton}
        />
      )}
      <Button label="Delete" variant="ghost" icon="trash-2" onPress={onDelete} />
    </View>
  );
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

function ChapterGap() {
  return <View style={styles.chapterGap} />;
}

function SkeletonChapters() {
  return (
    <View style={styles.skeletonList}>
      {SKELETON_CHAPTERS.map((index) => (
        <SkeletonBlock key={index} style={styles.skeletonChapter} borderRadius={radius.tile} />
      ))}
    </View>
  );
}

// Only reached when there was no library row to seed from — a deep link, or a cold start onto
// the book's own screen.
function LoadingHero() {
  return (
    <View style={styles.loadingWrap}>
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
      <SkeletonChapters />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface[0] },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  loadingWrap: { paddingHorizontal: 20, gap: 12 },
  failure: { paddingHorizontal: 20, gap: 12 },
  back: { alignSelf: "flex-start", marginTop: 12, marginBottom: 4, marginLeft: 8 },
  retry: { marginTop: 12, alignSelf: "flex-start" },
  hero: { flexDirection: "row", gap: 16, marginBottom: 20 },
  heroCopy: { flex: 1, gap: 8, justifyContent: "center" },
  coverHidden: { opacity: 0 },
  title: { fontSize: 26, lineHeight: 30 },
  metaList: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  skeletonCover: { width: 124, height: 186 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  flexButton: { flexGrow: 1 },
  console: { marginBottom: 24 },
  chapterHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  chapterGap: { height: CHAPTER_GAP },
  footer: { marginTop: 24 },
  skeletonList: { gap: CHAPTER_GAP },
  skeletonChapter: { width: "100%", height: CHAPTER_ROW_HEIGHT },
});
