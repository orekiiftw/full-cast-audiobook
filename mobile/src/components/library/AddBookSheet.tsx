import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { Book, BookResult } from "@/api/types";
import { AppText, Badge, Button, Eyebrow, Notice, Row, TextField } from "@/components/ui";
import { colors, radius } from "@/theme/tokens";
import type { AddBookModel } from "@/hooks/useAddBook";

interface AddBookSheetProps {
  visible: boolean;
  model: AddBookModel;
  onClose: () => void;
  onAdded: (book: Book) => void;
}

function resultMeta(result: BookResult): string {
  const author = result.authors.join(", ") || "Unknown author";
  const format = result.format.toUpperCase();
  const size = result.filesize ? ` · ${Math.round(result.filesize / (1024 * 1024))} MB` : "";
  return `${author} · ${format}${size}`;
}

export function AddBookSheet({ visible, model, onClose, onAdded }: AddBookSheetProps) {
  const submitting = model.submittingId !== null;

  const add = async (result: BookResult) => {
    const book = await model.addResult(result);
    if (book) onAdded(book);
  };

  const addManual = async () => {
    const book = await model.addManual();
    if (book) onAdded(book);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Row style={styles.sheetHeader}>
              <View style={styles.sheetTitle}>
                <Eyebrow>Add to the stage</Eyebrow>
                <AppText variant="titleLg">Find a book</AppText>
              </View>
              <Button label="Close" variant="ghost" onPress={onClose} />
            </Row>

            <TextField
              label="Title"
              value={model.title}
              onChangeText={model.setTitle}
              placeholder="The Left Hand of Darkness"
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={() => void model.search()}
            />
            <TextField
              label="Author"
              value={model.author}
              onChangeText={model.setAuthor}
              placeholder="Ursula K. Le Guin"
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={() => void model.search()}
            />

            <Row style={styles.actions}>
              <Button
                label="Search DRM-free copies"
                icon="search"
                onPress={() => void model.search()}
                loading={model.searching}
                disabled={submitting}
              />
              <Button label="Add by title" variant="secondary" onPress={() => void addManual()} loading={model.submittingId === "manual"} />
            </Row>

            {model.error ? <Notice tone="error" message={model.error} /> : null}

            {model.results && model.results.length > 0 ? (
              <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent} showsVerticalScrollIndicator={false}>
                <Eyebrow>{model.results.length} matches</Eyebrow>
                {model.results.slice(0, 20).map((result) => (
                  <Pressable
                    key={`${result.provider}:${result.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${result.title}`}
                    disabled={submitting}
                    onPress={() => void add(result)}
                    style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.surface[3] }]}
                  >
                    <View style={styles.resultCopy}>
                      <AppText variant="bodyLg" numberOfLines={2}>
                        {result.title}
                      </AppText>
                      <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                        {resultMeta(result)}
                      </AppText>
                    </View>
                    <Badge label={model.submittingId === result.id ? "Adding…" : result.provider} tone="neutral" />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(5, 8, 6, 0.72)" },
  sheetWrap: { maxHeight: "88%" },
  sheet: {
    backgroundColor: colors.surface[1],
    borderTopLeftRadius: radius.stage,
    borderTopRightRadius: radius.stage,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 14,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line.strong, marginBottom: 6 },
  sheetHeader: { justifyContent: "space-between" },
  sheetTitle: { gap: 4 },
  actions: { gap: 10, flexWrap: "wrap" },
  results: { maxHeight: 320 },
  resultsContent: { gap: 8 },
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
  resultCopy: { flex: 1, gap: 3 },
});
