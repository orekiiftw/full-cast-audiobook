import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import type { Segment } from "@/api/types";
import { AppText, Spinner } from "@/components/ui";
import { isPlayableSegment } from "@/lib/segmentStatus";
import { colors, radius } from "@/theme/tokens";

// After the listener scrolls the transcript by hand, following the active line pauses briefly
// so their reading position is not yanked away mid-scroll — the web client's 5s grace period.
const MANUAL_SCROLL_GRACE_MS = 5000;

interface TranscriptListProps {
  segments: Segment[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onManualScroll?: () => void;
}

export function TranscriptList({ segments, currentIndex, onSelect, onManualScroll }: TranscriptListProps) {
  const listRef = useRef<FlatList<Segment>>(null);
  const lastManualScrollRef = useRef(0);
  const [detached, setDetached] = useState(false);

  const scrollToActive = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= segments.length) return;
    listRef.current?.scrollToIndex({ index: currentIndex, viewPosition: 0.4, animated: true });
  }, [currentIndex, segments.length]);

  useEffect(() => {
    if (Date.now() - lastManualScrollRef.current < MANUAL_SCROLL_GRACE_MS) {
      setDetached(true);
      return;
    }
    setDetached(false);
    scrollToActive();
  }, [currentIndex, scrollToActive]);

  const markManualScroll = () => {
    lastManualScrollRef.current = Date.now();
    onManualScroll?.();
  };

  const returnToActive = () => {
    lastManualScrollRef.current = 0;
    setDetached(false);
    scrollToActive();
  };

  return (
    <View style={styles.wrapper}>
      <FlatList
        ref={listRef}
        data={segments}
        keyExtractor={(segment) => segment.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={markManualScroll}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
        }}
        renderItem={({ item, index }) => {
          const active = index === currentIndex;
          const playable = isPlayableSegment(item);
          const failed = item.status === "failed";
          const pending = !playable && !failed;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Line ${index + 1}${playable ? "" : ", not yet voiced"}`}
              accessibilityState={{ selected: active, disabled: !playable }}
              disabled={!playable}
              onPress={() => onSelect(index)}
              style={[styles.row, active && styles.rowActive]}
            >
              <AppText
                variant="bodyLg"
                tone={active ? "primary" : failed ? "disabled" : "tertiary"}
                style={[styles.text, failed && styles.failedText]}
              >
                {item.rawText}
              </AppText>
              {pending ? (
                <View style={styles.pending}>
                  {item.status === "processing" ? <Spinner size={10} /> : null}
                  <AppText variant="micro" uppercase tone="goldStrong">
                    {item.status === "processing" ? "Performing…" : "Queued"}
                  </AppText>
                </View>
              ) : null}
              {failed ? (
                <AppText variant="micro" uppercase tone="danger">
                  Couldn’t be voiced
                </AppText>
              ) : null}
            </Pressable>
          );
        }}
      />

      {detached ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the current line"
          onPress={returnToActive}
          style={styles.jumpBack}
        >
          <AppText variant="caption" tone="primary">
            Back to the current line
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  content: { paddingVertical: 12, gap: 4 },
  row: {
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  rowActive: { borderColor: colors.line.accent, backgroundColor: "rgba(196, 146, 62, 0.1)" },
  text: { lineHeight: 25 },
  failedText: { textDecorationLine: "line-through" },
  pending: { flexDirection: "row", alignItems: "center", gap: 6 },
  jumpBack: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    backgroundColor: colors.surface[3],
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
});
