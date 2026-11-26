import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AnimatedProgressBar, PulsingDot } from "@/components/ui/motion";
import { AppText, Badge, Button, Eyebrow, Notice, Row, Spinner } from "@/components/ui";
import { STAGING_STAGES, stageStateOf, stagingHeadline, voicingSummary, type StagingState, type StageState } from "@/lib/addStage";
import { colors, radius } from "@/theme/tokens";

// The studio console, shared by the add sheet (where the performance is announced) and the book
// detail screen (where it continues). The ladder is the same five stages the server walks, the
// active one carries the latest line from the stream verbatim, and voicing adds the per-chapter
// bar the web client shows.

interface StagingPanelProps {
  staging: StagingState;
  onRetry?: () => void;
  retrying?: boolean;
  maxLogLines?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function StagingPanel({ staging, onRetry, retrying = false, maxLogLines = 6, label = "Studio console", style }: StagingPanelProps) {
  const failed = staging.bookStatus === "failed";
  const ready = staging.bookStatus === "ready";
  const summary = voicingSummary(staging);
  const showVoicing = staging.chapters.length > 0 && staging.stageIndex >= STAGING_STAGES.length - 1;
  const latest = staging.log[0]?.text ?? null;
  const log = staging.log.slice(0, maxLogLines);

  return (
    <View style={[styles.panel, style]}>
      <Row style={styles.head}>
        <View style={styles.headCopy}>
          <Eyebrow>{label}</Eyebrow>
          <AppText variant="caption" tone={failed ? "danger" : "secondary"} numberOfLines={1}>
            {stagingHeadline(staging)}
          </AppText>
        </View>
        {ready ? (
          <Badge label="Ready" tone="emerald" />
        ) : failed ? (
          <Badge label="Stopped" tone="red" />
        ) : (
          <Row style={styles.live}>
            <PulsingDot />
            <AppText variant="micro" uppercase tone="success">
              Live
            </AppText>
          </Row>
        )}
      </Row>

      <View style={styles.ladder}>
        {STAGING_STAGES.map((stage, index) => {
          const state = stageStateOf(staging, index);
          return (
            <View key={stage.id} style={styles.stageRow}>
              <StageMarker state={state} />
              <View style={styles.stageCopy}>
                <AppText
                  variant="caption"
                  tone={state === "active" ? "primary" : state === "failed" ? "danger" : state === "done" ? "secondary" : "disabled"}
                  bold={state === "active"}
                >
                  {stage.label}
                </AppText>
                {state === "active" && latest ? (
                  <AppText variant="micro" mono tone="tertiary" numberOfLines={2} style={styles.stageDetail}>
                    {latest}
                  </AppText>
                ) : null}
              </View>
              {state === "active" && stage.id === "voice" && summary && summary.overallTotal > 0 ? (
                <AppText variant="micro" mono tone="gold">
                  {summary.overallDone}/{summary.overallTotal}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>

      {showVoicing && summary ? (
        <View style={styles.voicing}>
          <Row style={styles.voicingHead}>
            <AppText variant="caption" tone="secondary" mono>
              {summary.label}
            </AppText>
            <AppText variant="micro" mono tone="tertiary">
              {Math.round(summary.ratio * 100)}%
            </AppText>
          </Row>
          <AnimatedProgressBar ratio={summary.ratio} />
          {staging.readyCount > 0 ? (
            <AppText variant="micro" tone="tertiary">
              {staging.readyCount} of {staging.chapters.length} chapters fully voiced
            </AppText>
          ) : null}
        </View>
      ) : null}

      {failed ? (
        <View style={styles.failure}>
          <Notice tone="error" message={staging.error ?? "The performance stopped before it finished."} />
          {onRetry ? (
            <Button label="Retry the performance" variant="secondary" icon="refresh-cw" onPress={onRetry} loading={retrying} />
          ) : null}
        </View>
      ) : null}

      {log.length > 0 ? (
        <View style={styles.log}>
          {log.map((entry, index) => (
            <View key={entry.id} style={styles.logRow}>
              <AppText variant="micro" mono tone="disabled">
                ›
              </AppText>
              <AppText variant="caption" mono tone={logTone(entry.text, index)} numberOfLines={2} style={styles.logText}>
                {entry.text}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StageMarker({ state }: { state: StageState }) {
  if (state === "done") {
    return (
      <View style={styles.markerDone}>
        <Feather name="check" size={10} color={colors.ink.inverse} />
      </View>
    );
  }
  if (state === "active") {
    return (
      <View style={styles.markerActive}>
        <Spinner size={12} />
      </View>
    );
  }
  if (state === "failed") {
    return (
      <View style={styles.markerFailed}>
        <Feather name="alert-triangle" size={10} color={colors.danger[300]} />
      </View>
    );
  }
  return <View style={styles.markerPending} />;
}

function logTone(text: string, index: number) {
  if (/fail|error|quota|⛔|❌/i.test(text)) return "danger" as const;
  if (/warn|⚠/i.test(text)) return "gold" as const;
  return index === 0 ? ("secondary" as const) : ("tertiary" as const);
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
    backgroundColor: colors.surface[1],
    padding: 16,
    gap: 14,
  },
  head: { justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  headCopy: { flex: 1, gap: 4 },
  live: { gap: 5, alignItems: "center" },
  ladder: { gap: 10 },
  stageRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stageCopy: { flex: 1, gap: 2 },
  stageDetail: { fontSize: 10, lineHeight: 14, letterSpacing: 0 },
  markerDone: {
    width: 16,
    height: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold[400],
    marginTop: 1,
  },
  markerActive: { width: 16, height: 16, alignItems: "center", justifyContent: "center", marginTop: 1 },
  markerFailed: { width: 16, height: 16, alignItems: "center", justifyContent: "center", marginTop: 1 },
  markerPending: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
    marginTop: 1,
  },
  voicing: { gap: 6 },
  voicingHead: { justifyContent: "space-between" },
  failure: { gap: 10 },
  log: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line.hairline, paddingTop: 10 },
  logRow: { flexDirection: "row", gap: 8 },
  logText: { flex: 1, fontSize: 11, lineHeight: 16, letterSpacing: 0 },
});
