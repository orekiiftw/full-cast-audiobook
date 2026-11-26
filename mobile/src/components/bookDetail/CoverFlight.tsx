import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { CoverArt } from "@/components/ui";
import type { Frame } from "@/lib/coverFlight";
import { motion } from "@/theme/tokens";

// The cover in flight between the library card and the detail hero: one absolutely positioned
// copy of the cover, animated from the card's window rectangle to the hero's with a single
// shared progress value, so it runs on the UI thread and never re-renders React.

interface CoverFlightProps {
  title: string;
  coverR2Key: string | null;
  from: Frame;
  to: Frame;
  onDone: () => void;
}

export function CoverFlight({ title, coverR2Key, from, to, onDone }: CoverFlightProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    progress.value = withTiming(1, { duration: motion.slow + 40, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [onDone, progress, reduced]);

  const flightStyle = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      left: from.x + (to.x - from.x) * t,
      top: from.y + (to.y - from.y) * t,
      width: from.width + (to.width - from.width) * t,
      height: from.height + (to.height - from.height) * t,
      borderRadius: 10 + t * 2,
      opacity: 1 - t * 0.06,
    };
  });

  return (
    <Animated.View testID="cover-flight" pointerEvents="none" style={[styles.layer, flightStyle]}>
      <CoverArt coverR2Key={coverR2Key} title={title} width={to.width} style={styles.cover} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", zIndex: 30 },
  cover: { width: "100%", height: "100%", borderRadius: 12 },
});
