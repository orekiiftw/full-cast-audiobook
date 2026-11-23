import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import { colors, motion } from "@/theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// The motion layer the RN primitives do not ship: press feedback, staggered entrances, skeleton
// pulses and a progress bar that slides instead of jumping. Everything here is Reanimated-only
// (no gesture-handler) so it runs in Expo Go and in the web export alike.

export interface PressableScaleProps {
  children: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "tab";
  accessibilityState?: { disabled?: boolean; selected?: boolean; busy?: boolean };
  hitSlop?: number;
  // How far the surface shrinks under the finger; cards want less than buttons.
  activeScale?: number;
}

export function PressableScale({
  children,
  onPress,
  style,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  activeScale = 0.97,
}: PressableScaleProps) {
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - activeScale) }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withSpring(1, { damping: 22, stiffness: 380, mass: 0.5 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 18, stiffness: 260, mass: 0.6 });
      }}
      style={[style, animatedStyle, disabled ? styles.disabled : null]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function FadeUp({
  children,
  index = 0,
  step = 45,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  step?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(index * step, withTiming(1, { duration: motion.enter, easing: Easing.out(Easing.cubic) }));
  }, [index, progress, step]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export function SkeletonBlock({ style, borderRadius = 8 }: { style?: StyleProp<ViewStyle>; borderRadius?: number }) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[styles.skeleton, { borderRadius }, style, animatedStyle]} />;
}

export function AnimatedProgressBar({
  ratio,
  tone = colors.gold[400],
  height = 4,
  trackColor = "rgba(242, 238, 228, 0.08)",
}: {
  ratio: number;
  tone?: string;
  height?: number;
  trackColor?: string;
}) {
  const target = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const width = useSharedValue(target);

  useEffect(() => {
    width.value = withTiming(target, { duration: motion.slow, easing: Easing.out(Easing.cubic) });
  }, [target, width]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: trackColor }]}
    >
      <Animated.View style={[styles.fill, { height, borderRadius: height / 2, backgroundColor: tone }, fillStyle]} />
    </View>
  );
}

// The "live" tell beside a running label: a dot that breathes, the web client's animate-breathe.
export function PulsingDot({ color = colors.success[300], size = 6 }: { color?: string; size?: number }) {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, animatedStyle]} />;
}

// A skeleton row for the search sheet's results, matching the real row's height and rhythm.
export function SkeletonRow({ style }: { style?: StyleProp<ViewStyle> }) {
  const lines = useMemo(() => [0.85, 0.55] as const, []);
  return (
    <View style={[styles.skeletonRow, style]}>
      <View style={styles.skeletonRowCopy}>
        {lines.map((width, index) => (
          <SkeletonBlock key={index} style={{ width: `${width * 100}%`, height: index === 0 ? 14 : 11 }} />
        ))}
      </View>
      <SkeletonBlock style={{ width: 54, height: 22, borderRadius: 999 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.55 },
  skeleton: { backgroundColor: colors.surface[2] },
  track: { overflow: "hidden", width: "100%" },
  fill: { position: "absolute", left: 0, top: 0 },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
    backgroundColor: colors.surface[1],
  },
  skeletonRowCopy: { flex: 1, gap: 8 },
});
