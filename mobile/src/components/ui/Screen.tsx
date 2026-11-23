import { ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { colors, radius } from "@/theme/tokens";
import { AppText, Eyebrow } from "./Text";
import { Button } from "./Button";

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const body = <View style={[styles.body, style]}>{children}</View>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function Notice({
  tone = "info",
  message,
  action,
}: {
  tone?: "info" | "error";
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={[styles.notice, tone === "error" && styles.noticeError]}>
      <Feather
        name={tone === "error" ? "alert-triangle" : "info"}
        size={15}
        color={tone === "error" ? colors.danger[300] : colors.info[300]}
      />
      <AppText variant="caption" tone="secondary" style={styles.noticeText}>
        {message}
      </AppText>
      {action ? <Button label={action.label} variant="ghost" size="md" onPress={action.onPress} /> : null}
    </View>
  );
}

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
  children?: React.ReactNode;
}

export function EmptyState({ icon, eyebrow, title, description, action, children }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={22} color={colors.gold[300]} />
      </View>
      <Eyebrow>{eyebrow}</Eyebrow>
      <AppText variant="displayMd" center>
        {title}
      </AppText>
      <AppText variant="body" tone="secondary" center style={styles.emptyCopy}>
        {description}
      </AppText>
      {action ? <Button label={action.label} icon="plus" onPress={action.onPress} size="lg" /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface[0] },
  scrollContent: { flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: 20, paddingBottom: 32 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    backgroundColor: colors.surface[2],
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeError: { borderColor: "rgba(244, 151, 139, 0.4)" },
  noticeText: { flex: 1 },
  empty: { alignItems: "center", gap: 12, paddingVertical: 48, paddingHorizontal: 8 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.accent,
    backgroundColor: "rgba(196, 146, 62, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyCopy: { maxWidth: 340, marginBottom: 8 },
});
