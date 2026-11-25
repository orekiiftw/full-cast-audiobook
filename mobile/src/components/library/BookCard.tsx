import { memo, useRef, type ComponentRef } from "react";
import { Alert, StyleSheet, View } from "react-native";
import type { Book } from "@/api/types";
import { Badge, CoverArt, IconButton, AppText, LevelMeter, PressableScale } from "@/components/ui";
import { rememberBookSeed } from "@/lib/bookSeed";
import { startCoverFlight } from "@/lib/coverFlight";
import { colors, radius } from "@/theme/tokens";
import { bookStatusOf } from "./bookStatus";

// The meta block under a cover is a fixed height — two lines of title, one of author, and the
// slot the status badge sits in — so every card in the grid has exactly one height and the list
// can hand `getItemLayout` arithmetic instead of measurements.
export const BOOK_CARD_META_HEIGHT = 93;
export const BOOK_CARD_COVER_GAP = 10;

interface BookCardProps {
  book: Book;
  width: number;
  onSelect: (book: Book) => void;
  onDelete: (book: Book) => void;
}

// Memoised: the library re-renders when an add finishes or a pull-to-refresh lands, and only the
// cards whose book row actually changed should follow it.
function BookCardBase({ book, width, onSelect, onDelete }: BookCardProps) {
  const status = bookStatusOf(book.status);
  const author = book.author.trim() || "Unknown author";
  const coverRef = useRef<ComponentRef<typeof View> | null>(null);

  const confirmDelete = () => {
    Alert.alert(`Delete "${book.title}"?`, "The performance is removed from your library.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(book) },
    ]);
  };

  // The detail screen opens on this row's data and flies this cover into its hero, so the row is
  // parked as a seed and the cover's window rectangle is handed over before navigating. If the
  // measure never answers, the navigation still happens — it just loses the flight.
  const open = () => {
    rememberBookSeed(book);
    let navigated = false;
    const go = () => {
      if (navigated) return;
      navigated = true;
      onSelect(book);
    };
    const cover = coverRef.current;
    if (!cover) {
      go();
      return;
    }
    cover.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      startCoverFlight(book.id, { x, y, width: measuredWidth, height: measuredHeight });
      go();
    });
    setTimeout(go, 32);
  };

  return (
    <View style={[styles.card, { width }]}>
      <PressableScale
        accessibilityLabel={book.status === "ready" ? `${book.title} by ${author}` : `${book.title} by ${author}, ${status.label}`}
        onPress={open}
        style={styles.press}
        activeScale={0.975}
      >
        <View ref={coverRef} collapsable={false} style={{ width }}>
          <CoverArt coverR2Key={book.coverR2Key} title={book.title} width={width} />
        </View>
        <View style={styles.meta}>
          <AppText variant="bodyLg" numberOfLines={2} style={styles.title}>
            {book.title}
          </AppText>
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {author}
          </AppText>
          <View style={styles.statusSlot}>
            {book.status !== "ready" ? (
              <>
                {status.active ? <LevelMeter height={10} /> : null}
                <Badge label={status.label} tone={status.tone} />
              </>
            ) : null}
          </View>
        </View>
      </PressableScale>

      <View style={styles.deleteSlot}>
        <IconButton icon="trash-2" label={`Delete ${book.title}`} onPress={confirmDelete} size="sm" />
      </View>
    </View>
  );
}

export const BookCard = memo(BookCardBase);
BookCard.displayName = "BookCard";

const styles = StyleSheet.create({
  card: { gap: 10 },
  press: { gap: BOOK_CARD_COVER_GAP },
  meta: { height: BOOK_CARD_META_HEIGHT, gap: 3, paddingHorizontal: 2 },
  title: { lineHeight: 22, height: 44 },
  statusSlot: { height: 24, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
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
