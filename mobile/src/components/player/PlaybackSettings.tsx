import { StyleSheet, View } from "react-native";
import { AppText, Eyebrow, PillButton } from "@/components/ui";
import { PLAYBACK_SPEEDS } from "@/playback/PlayerProvider";
import { SLEEP_PRESETS, formatSleepRemaining } from "@/playback/sleepTimer";
import type { SleepState } from "@/playback/sleepTimer";

interface PlaybackSettingsProps {
  playbackSpeed: number;
  sleep: SleepState;
  onSpeedChange: (rate: number) => void;
  onSleepChange: (seconds: number | null) => void;
}

export function PlaybackSettings({ playbackSpeed, sleep, onSpeedChange, onSleepChange }: PlaybackSettingsProps) {
  const remaining = formatSleepRemaining(sleep.remainingSeconds);

  return (
    <View style={styles.wrapper}>
      <View style={styles.group}>
        <Eyebrow>Speed</Eyebrow>
        <View style={styles.pills}>
          {PLAYBACK_SPEEDS.map((speed) => (
            <PillButton key={speed} label={`${speed}×`} active={speed === playbackSpeed} onPress={() => onSpeedChange(speed)} />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <View style={styles.sleepHead}>
          <Eyebrow>Sleep</Eyebrow>
          {remaining ? (
            <AppText variant="caption" tone="gold" mono>
              {remaining} left
            </AppText>
          ) : null}
        </View>
        <View style={styles.pills}>
          {SLEEP_PRESETS.map((preset) => (
            <PillButton
              key={preset.label}
              label={preset.label}
              active={sleep.preset === preset.seconds}
              onPress={() => onSleepChange(preset.seconds)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 14 },
  group: { gap: 8 },
  sleepHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
});
