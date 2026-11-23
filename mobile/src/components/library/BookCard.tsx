import { Alert, Pressable, StyleSheet, View } from "react-native";
import type { Book } from "@/api/types";
import { Badge, CoverArt, IconButton, AppText, LevelMeter } from "@/components/ui";
import { colors, radius } from "@/theme/tokens";
import { bookStatusOf } from "./bookStatus";

interface BookCardProps {
  book: Book;
  onSelect: (book: Book) => void;
  onDelete: (book: Book) => void;
}

export function BookCard({ book, onSelect, onDelete }: BookCardProps) {
  const status = bookStatusOf(book.status);
  const author = book.author.trim() || "Unknown author";

  const confirmDelete = () => {
    Alert.alert(`Delete "${book.title}"?`, "The performance is removed from your library.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(book) },
    ]);
  };

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={book.status === "ready" ? `${book.title} by ${author}` : `${book.title} by ${author}, ${status.label}`}
        onPress={() => onSelect(book)}
        style={({ pressed }) => [styles.press, pressed && { opacity: 0.86 }]}
      >
        <CoverArt coverR2Key={book.coverR2Key} title={book.title} width={152} style={styles.cover} />
        <View style={styles.meta}>
          <AppText variant="bodyLg" numberOfLines={2} style={styles.title}>
            {book.title}
          </AppText>
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {author}
          </AppText>
          {book.status !== "ready" ? (
            <View style={styles.statusRow}>
              {status.active ? <LevelMeter height={10} /> : null}
              <Badge label={status.label} tone={status.tone} />
            </View>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.deleteSlot}>
        <IconButton icon="trash-2" label={`Delete ${book.title}`} onPress={confirmDelete} size="sm" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "47%", gap: 10, marginBottom: 24 },
  press: { gap: 10 },
  cover: { alignSelf: "stretch", width: "100%" },
  meta: { gap: 3, paddingHorizontal: 2 },
  title: { lineHeight: 22 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  deleteSlot: {
    position: "absolute",
    top: 6,
    right: 6,
    borderRadius: radius.control,
    backgroundColor: "rgba(11, 15, 13, 0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
  },
});
