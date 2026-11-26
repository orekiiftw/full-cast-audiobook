import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import type { Book, BookResult } from "@/api/types";
import { AppText, Badge, Button, Eyebrow, Notice, Row, Spinner, TextField } from "@/components/ui";
import { FadeUp, PressableScale, SkeletonRow } from "@/components/ui/motion";
import { SearchStatus } from "@/components/library/SearchStatus";
import { StagingPanel } from "@/components/staging/StagingPanel";
import { useBookStaging } from "@/hooks/useBookStaging";
import type { AddBookModel } from "@/hooks/useAddBook";
import { errorHaptic, successHaptic, tapHaptic } from "@/lib/haptics";
import { formatFormat, formatSize, partialNotice, providerLabel } from "@/lib/searchFeedback";
import { dragOffset, isDismissDrag, shouldDismissSheet } from "@/lib/sheetGesture";
import { colors, motion, radius } from "@/theme/tokens";

interface AddBookSheetProps {
  visible: boolean;
  model: AddBookModel;
  onClose: () => void;
  // The book row exists and has something to play (or the listener asked to follow along):
  // the sheet hands off to the detail screen, which shows the same console.
  onOpenBook: (book: Book) => void;
}

const HANDOFF_DELAY_MS = 1500;

function resultMeta(result: BookResult): string {
  const parts: string[] = [];
  const authors = result.authors.join(", ");
  if (authors) parts.push(authors);
  if (result.year) parts.push(String(result.year));
  if (result.language) parts.push(result.language.toUpperCase());
  return parts.join(" · ") || "Unknown author";
}

export function AddBookSheet({ visible, model, onClose, onOpenBook }: AddBookSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [picked, setPicked] = useState<Book | null>(null);
  const staging = useBookStaging(picked?.id ?? null, picked?.title ?? model.title.trim() ?? null);

  const translateY = useSharedValue(windowHeight);
  const backdrop = useSharedValue(0);
  const closing = useRef(false);
  const handedOff = useRef(false);

  const animateIn = useCallback(() => {
    closing.current = false;
    translateY.value = withSpring(0, { damping: 24, stiffness: 220, mass: 0.9 });
    backdrop.value = withTiming(1, { duration: motion.base });
  }, [backdrop, translateY]);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    backdrop.value = withTiming(0, { duration: motion.base });
    translateY.value = withTiming(windowHeight, { duration: motion.base, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [backdrop, onClose, translateY, windowHeight]);

  useEffect(() => {
    if (visible) {
      handedOff.current = false;
      animateIn();
      return;
    }
    // Hidden by the parent: drop the staged book so the next open starts on the form.
    setPicked(null);
    closing.current = false;
  }, [visible, animateIn]);

  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture as well as bubble: on web the gesture can start on a text node inside the
        // header, and only the capture phase sees the move before text selection claims it.
        onMoveShouldSetPanResponder: (_, gesture) => isDismissDrag(gesture.dy, gesture.dx),
        onMoveShouldSetPanResponderCapture: (_, gesture) => isDismissDrag(gesture.dy, gesture.dx),
        onPanResponderMove: (_, gesture) => {
          translateY.value = dragOffset(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (shouldDismissSheet(gesture.dy, gesture.vy)) {
            // PanResponder callbacks run on the JS thread, so the sheet can close directly.
            dismissRef.current();
            return;
          }
          translateY.value = withSpring(0, { damping: 24, stiffness: 220 });
        },
        onPanResponderTerminate: () => {
          translateY.value = withSpring(0, { damping: 24, stiffness: 220 });
        },
      }),
    [translateY],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  const add = async (result: BookResult) => {
    tapHaptic();
    const book = await model.addResult(result);
    if (book) setPicked(book);
  };

  const addManual = async () => {
    tapHaptic();
    const book = await model.addManual();
    if (book) setPicked(book);
  };

  // A failure must be felt as well as read; the same for the moment the first chapter lands.
  useEffect(() => {
    if (model.failure) errorHaptic();
  }, [model.failure]);

  useEffect(() => {
    if (staging.staging.bookStatus === "failed") errorHaptic();
  }, [staging.staging.bookStatus]);

  const playable = staging.staging.playableChapterId !== null;
  useEffect(() => {
    if (!picked || !playable || handedOff.current) return;
    handedOff.current = true;
    successHaptic();
    const timer = setTimeout(() => onOpenBook(picked), HANDOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [picked, playable, onOpenBook]);

  const searching = model.searching;
  const submitting = model.submittingId !== null;
  const results = model.results ?? [];
  const partial = model.pending !== null ? partialNotice(model.pending) : null;
  const sourceCount = model.providers?.length ?? null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <View style={styles.host}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={dismiss} />
        </Animated.View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { maxHeight: windowHeight * 0.9 }, sheetStyle]}>
            <View {...dragResponder.panHandlers} style={styles.dragZone}>
              <View style={styles.grabber} />
              <Row style={styles.sheetHeader}>
                <View style={styles.sheetTitle}>
                  <Eyebrow>{picked ? "In the studio" : "Add to the stage"}</Eyebrow>
                  <AppText variant="titleLg" numberOfLines={2}>
                    {picked ? picked.title : "Find a book"}
                  </AppText>
                </View>
                {picked ? null : <Button label="Close" variant="ghost" onPress={dismiss} />}
              </Row>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {picked ? (
                <StagingPanel staging={staging.staging} onRetry={() => void staging.retry()} retrying={staging.retrying} maxLogLines={5} />
              ) : (
                <>
                  <View style={styles.fields}>
                    <TextField
                      label="Title"
                      value={model.title}
                      onChangeText={model.setTitle}
                      placeholder="The Left Hand of Darkness"
                      autoCapitalize="words"
                      returnKeyType="search"
                      editable={!submitting}
                      onSubmitEditing={() => void model.search()}
                    />
                    <TextField
                      label="Author"
                      value={model.author}
                      onChangeText={model.setAuthor}
                      placeholder="Ursula K. Le Guin"
                      autoCapitalize="words"
                      returnKeyType="search"
                      editable={!submitting}
                      onSubmitEditing={() => void model.search()}
                    />
                  </View>

                  <Row style={styles.actions}>
                    <Button
                      label={searching ? "Searching…" : "Search DRM-free copies"}
                      icon="search"
                      onPress={() => void model.search()}
                      loading={searching}
                      disabled={submitting}
                      style={styles.searchButton}
                    />
                    <Button
                      label="Add by title"
                      variant="secondary"
                      onPress={() => void addManual()}
                      loading={model.submittingId === "manual"}
                      disabled={searching}
                    />
                  </Row>

                  {model.failure ? <Notice tone="error" title={model.failure.title} message={model.failure.detail} /> : null}
                  {partial ? <Notice tone="info" title={partial.title} message={partial.detail} /> : null}

                  {searching ? (
                    <View style={styles.skeletons}>
                      <SearchStatus
                        live
                        startedAt={model.startedAt}
                        finishedAt={model.finishedAt}
                        roster={model.providers}
                        pending={model.pending}
                      />
                      {[0, 1, 2].map((index) => (
                        <SkeletonRow key={index} />
                      ))}
                    </View>
                  ) : results.length > 0 ? (
                    <View style={styles.results}>
                      <SearchStatus
                        live={false}
                        startedAt={model.startedAt}
                        finishedAt={model.finishedAt}
                        roster={model.providers}
                        pending={model.pending}
                      />
                      <Eyebrow>
                        {results.length} {results.length === 1 ? "match" : "matches"}
                        {sourceCount ? ` · ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}` : ""}
                      </Eyebrow>
                      {results.slice(0, 20).map((result, index) => (
                        <FadeUp key={`${result.provider}:${result.id}`} index={index} step={35}>
                          <ResultRow
                            result={result}
                            adding={model.submittingId === result.id}
                            disabled={submitting}
                            onPress={() => void add(result)}
                          />
                        </FadeUp>
                      ))}
                    </View>
                  ) : model.searched && !model.failure ? (
                    <View style={styles.empty}>
                      <Feather name="search" size={18} color={colors.ink.tertiary} />
                      <AppText variant="caption" tone="secondary" center>
                        No DRM-free copy found. Try the author alone, or add it by title and the studio will keep looking.
                      </AppText>
                    </View>
                  ) : (
                    <View style={styles.empty}>
                      <Feather name="compass" size={18} color={colors.ink.tertiary} />
                      <AppText variant="caption" tone="tertiary" center>
                        Narratea looks for a DRM-free EPUB, then casts one narrator and voices it chapter by chapter.
                      </AppText>
                    </View>
                  )}
                </>
              )}
            </ScrollView>

            <View style={styles.footer}>
              {picked ? (
                <>
                  <AppText variant="caption" tone="tertiary" style={styles.footerNote}>
                    {playable
                      ? "The first lines are voiced — opening the studio."
                      : "You can close this and the studio keeps working in the background."}
                  </AppText>
                  <Row style={styles.footerActions}>
                    <Button label="Close" variant="ghost" onPress={dismiss} />
                    <Button
                      label="Open the studio"
                      icon="arrow-right"
                      onPress={() => {
                        tapHaptic();
                        onOpenBook(picked);
                      }}
                      style={styles.openButton}
                    />
                  </Row>
                </>
              ) : null}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function ResultRow({ result, adding, disabled, onPress }: { result: BookResult; adding: boolean; disabled: boolean; onPress: () => void }) {
  const size = formatSize(result.filesize);
  const isEpub = result.format === "epub";

  return (
    <PressableScale
      accessibilityLabel={`Add ${result.title} from ${providerLabel(result.provider)}`}
      onPress={onPress}
      disabled={disabled || adding}
      style={styles.result}
      activeScale={0.985}
    >
      <View style={styles.resultCopy}>
        <AppText variant="bodyLg" numberOfLines={2}>
          {result.title}
        </AppText>
        <AppText variant="caption" tone="tertiary" numberOfLines={1}>
          {resultMeta(result)}
        </AppText>
        <Row style={styles.resultTags}>
          <Badge label={providerLabel(result.provider)} tone="neutral" />
          <Badge label={formatFormat(result.format)} tone={isEpub ? "emerald" : "gold"} />
          {size ? (
            <AppText variant="micro" mono tone="tertiary">
              {size}
            </AppText>
          ) : null}
        </Row>
      </View>
      <View style={styles.resultAction}>{adding ? <Spinner size={14} /> : <Feather name="plus" size={16} color={colors.gold[300]} />}</View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5, 8, 6, 0.74)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface[1],
    borderTopLeftRadius: radius.stage,
    borderTopRightRadius: radius.stage,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    paddingBottom: 18,
  },
  dragZone: { paddingHorizontal: 20, paddingTop: 10, gap: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line.strong, marginBottom: 6 },
  sheetHeader: { justifyContent: "space-between", gap: 12 },
  sheetTitle: { gap: 4, flex: 1 },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 14 },
  fields: { gap: 12 },
  actions: { gap: 10, flexWrap: "wrap" },
  searchButton: { flexGrow: 1 },
  skeletons: { gap: 8 },
  results: { gap: 8 },
  result: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
    backgroundColor: colors.surface[2],
  },
  resultCopy: { flex: 1, gap: 4 },
  resultTags: { gap: 6, flexWrap: "wrap", alignItems: "center" },
  resultAction: { width: 28, alignItems: "center" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 18, paddingHorizontal: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 8 },
  footerNote: { textAlign: "center" },
  footerActions: { gap: 10, justifyContent: "flex-end" },
  openButton: { flexGrow: 1 },
});
