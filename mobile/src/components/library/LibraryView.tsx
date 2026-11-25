import { useCallback, useEffect, useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Book } from "@/api/types";
import { AppText, Button, EmptyState, Eyebrow, LivePulse, Notice } from "@/components/ui";
import { SkeletonBlock } from "@/components/ui/motion";
import { gridColumnWidth, gridItemLayout } from "@/lib/listLayout";
import { perfMark } from "@/lib/perf";
import { colors, radius } from "@/theme/tokens";
import { BookCard, BOOK_CARD_COVER_GAP, BOOK_CARD_META_HEIGHT } from "./BookCard";

interface LibraryViewProps {
  books: Book[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  signedInAs: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onAddBook: () => void;
  onSelectBook: (book: Book) => void;
  onDeleteBook: (book: Book) => void;
  onSignOut: () => void;
  /** The player dock, rendered under the list while a chapter is loaded. */
  dock?: React.ReactNode;
}

const COLUMNS = 2;
const PAGE_PADDING = 20;
const COLUMN_GAP = 16;
const CARD_ROW_GAP = 24;
const SKELETON_CARDS = [0, 1, 2, 3];

function SkeletonGrid({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={styles.skeletonGrid}>
      {SKELETON_CARDS.map((key) => (
        <View key={key} style={{ width: cardWidth, gap: 10, marginBottom: CARD_ROW_GAP }}>
          <SkeletonBlock style={{ width: cardWidth, height: cardWidth * 1.5 }} borderRadius={radius.control} />
          <SkeletonBlock style={{ width: cardWidth * 0.8, height: 12 }} />
          <SkeletonBlock style={{ width: cardWidth * 0.55, height: 11 }} />
        </View>
      ))}
    </View>
  );
}

// The library: a two-column grid of cards. It is a `FlatList` rather than a `ScrollView` of
// cards because a listener's library grows and the studio's events re-render this screen — with
// virtualisation, memoised cards and a fixed row pitch, only the rows on screen exist and only
// the card whose row changed re-renders.
export function LibraryView({
  books,
  loading,
  refreshing,
  error,
  signedInAs,
  onRetry,
  onRefresh,
  onAddBook,
  onSelectBook,
  onDeleteBook,
  onSignOut,
  dock,
}: LibraryViewProps) {
  const { width: windowWidth } = useWindowDimensions();
  useEffect(() => {
    perfMark("library:open");
    if (!loading) perfMark("library:painted");
  }, [loading]);
  const cardWidth = gridColumnWidth(windowWidth, PAGE_PADDING, COLUMN_GAP, COLUMNS);
  const cardHeight = cardWidth * 1.5 + BOOK_CARD_COVER_GAP + BOOK_CARD_META_HEIGHT;
  const layout = useMemo(() => gridItemLayout(COLUMNS, cardHeight, CARD_ROW_GAP), [cardHeight]);

  const performingCount = books.filter(
    (book) => book.status === "discovering" || book.status === "casting" || book.status === "in_progress",
  ).length;
  const settled = !loading && !error;

  const renderCard = useCallback(
    ({ item }: { item: Book }) => <BookCard book={item} width={cardWidth} onSelect={onSelectBook} onDelete={onDeleteBook} />,
    [cardWidth, onDeleteBook, onSelectBook],
  );

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Eyebrow>
            Your collection
            {settled && books.length > 0 ? (
              <AppText variant="micro" tone="tertiary" uppercase>
                {"  ·  "}
                {books.length} {books.length === 1 ? "title" : "titles"}
                {performingCount > 0 ? `  ·  ${performingCount} performing` : ""}
              </AppText>
            ) : null}
          </Eyebrow>
          <View style={styles.titleRow}>
            <AppText variant="displayLg">Library</AppText>
            {performingCount > 0 ? <LivePulse /> : null}
          </View>
          <AppText variant="body" tone="secondary" style={styles.tagline}>
            Ebooks, performed. One warm narrator, directed line by line by AI emotion cues.
          </AppText>
        </View>
        {signedInAs ? <Button label="Sign out" variant="ghost" icon="log-out" onPress={onSignOut} /> : null}
      </View>
    ),
    [books.length, performingCount, settled, signedInAs, onSignOut],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {books.length > 0 ? <Button label="Add book" icon="plus" size="lg" onPress={onAddBook} style={styles.addButton} /> : null}
        {dock}
      </View>
    ),
    [books.length, dock, onAddBook],
  );

  const empty = loading ? (
    <SkeletonGrid cardWidth={cardWidth} />
  ) : error ? (
    <View style={styles.errorWrap}>
      <Notice tone="error" title="Your library didn't load" message={error} action={{ label: "Try again", onPress: onRetry }} />
    </View>
  ) : (
    <EmptyState
      icon="book-open"
      eyebrow="An empty stage"
      title="Begin a performance"
      description="Look a DRM-free title up by name — Narratea casts a narrator and begins voicing it while you listen."
      action={{ label: "Add book", onPress: onAddBook }}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <FlatList
        data={books}
        keyExtractor={(book) => book.id}
        renderItem={renderCard}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.column}
        getItemLayout={layout}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.gold[300]}
            colors={[colors.gold[400]]}
            progressBackgroundColor={colors.surface[2]}
          />
        }
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={40}
        windowSize={5}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface[0] },
  content: { paddingHorizontal: PAGE_PADDING, paddingBottom: 32 },
  column: { gap: COLUMN_GAP },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 20,
    marginBottom: 28,
  },
  headerCopy: { flex: 1, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  tagline: { maxWidth: 340 },
  footer: { marginTop: 4 },
  addButton: { marginTop: 4, marginBottom: 16 },
  errorWrap: { paddingVertical: 24 },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
});
