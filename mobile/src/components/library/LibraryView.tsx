import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { Book } from "@/api/types";
import { AppText, Button, EmptyState, Eyebrow, Notice, Screen } from "@/components/ui";
import { colors } from "@/theme/tokens";
import { BookCard } from "./BookCard";

interface LibraryViewProps {
  books: Book[];
  loading: boolean;
  error: string | null;
  signedInAs: string | null;
  onRetry: () => void;
  onAddBook: () => void;
  onSelectBook: (book: Book) => void;
  onDeleteBook: (book: Book) => void;
  onSignOut: () => void;
  /** The player dock, rendered under the list while a chapter is loaded. */
  dock?: React.ReactNode;
}

function SkeletonGrid() {
  return (
    <View style={styles.grid}>
      {[0, 1, 2, 3].map((key) => (
        <View key={key} style={styles.skeletonCard}>
          <View style={styles.skeletonCover} />
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, { width: "55%" }]} />
        </View>
      ))}
    </View>
  );
}

export function LibraryView({
  books,
  loading,
  error,
  signedInAs,
  onRetry,
  onAddBook,
  onSelectBook,
  onDeleteBook,
  onSignOut,
  dock,
}: LibraryViewProps) {
  const performingCount = books.filter(
    (book) => book.status === "discovering" || book.status === "casting" || book.status === "in_progress",
  ).length;
  const settled = !loading && !error;

  return (
    <Screen>
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
          <AppText variant="displayLg">Library</AppText>
          <AppText variant="body" tone="secondary" style={styles.tagline}>
            Ebooks, performed. One warm narrator, directed line by line by AI emotion cues.
          </AppText>
        </View>
        {signedInAs ? <Button label="Sign out" variant="ghost" icon="log-out" onPress={onSignOut} /> : null}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <SkeletonGrid />
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold[300]} />
            <AppText variant="caption" tone="tertiary">
              Opening your library…
            </AppText>
          </View>
        </View>
      ) : error ? (
        <View style={styles.errorWrap}>
          <Notice tone="error" message={error} action={{ label: "Try again", onPress: onRetry }} />
        </View>
      ) : books.length === 0 ? (
        <EmptyState
          icon="book-open"
          eyebrow="An empty stage"
          title="Begin a performance"
          description="Look a DRM-free title up by name — Narratea casts a narrator and begins voicing it while you listen."
          action={{ label: "Add book", onPress: onAddBook }}
        />
      ) : (
        <View style={styles.grid}>
          {books.map((book) => (
            <BookCard key={book.id} book={book} onSelect={onSelectBook} onDelete={onDeleteBook} />
          ))}
        </View>
      )}

      {books.length > 0 ? <Button label="Add book" icon="plus" size="lg" onPress={onAddBook} style={styles.addButton} /> : null}
      {dock}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 20, marginBottom: 28 },
  headerCopy: { flex: 1, gap: 8 },
  tagline: { maxWidth: 340 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  addButton: { marginTop: 4, marginBottom: 16 },
  loadingWrap: { gap: 20 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" },
  errorWrap: { paddingVertical: 24 },
  skeletonCard: { width: "47%", gap: 10, marginBottom: 24 },
  skeletonCover: { width: "100%", aspectRatio: 2 / 3, borderRadius: 10, backgroundColor: colors.surface[2] },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: colors.surface[2], width: "80%" },
});
