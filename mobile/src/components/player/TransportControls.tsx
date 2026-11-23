import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, elevation } from "@/theme/tokens";
import { IconButton } from "@/components/ui";

interface TransportControlsProps {
  isPlaying: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onTogglePlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}

// Same three-control cluster as the web player: skip back a line, the gold play/pause disc,
// skip forward a line (which also arms the wait for the next unvoiced line).
export function TransportControls({ isPlaying, canGoPrev, canGoNext, onTogglePlayPause, onPrev, onNext }: TransportControlsProps) {
  return (
    <View style={styles.row}>
      <IconButton icon="skip-back" label="Previous line" size="lg" disabled={!canGoPrev} onPress={onPrev} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "Pause" : "Play"}
        onPress={onTogglePlayPause}
        style={({ pressed }) => [styles.play, elevation.accent, pressed && { transform: [{ scale: 0.95 }] }]}
      >
        <Feather
          name={isPlaying ? "pause" : "play"}
          size={26}
          color={colors.ink.inverse}
          style={isPlaying ? undefined : { marginLeft: 3 }}
        />
      </Pressable>
      <IconButton icon="skip-forward" label="Next line" size="lg" disabled={!canGoNext} onPress={onNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  play: {
    width: 68,
    height: 68,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold[300],
  },
});
