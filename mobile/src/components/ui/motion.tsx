import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { ringRotation } from "@/lib/progressRing";
import { colors, motion } from "@/theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// The motion layer the RN primitives do not ship: press feedback, staggered entrances, skeleton
// pulses, progress bars and rings, and the "live" tell. Everything here is Reanimated-only (no
// gesture-handler, no SVG) so it runs in Expo Go and in the web export alike, and every
// animation is driven by a shared value — never by React state per frame.
//
// Each one honours the platform's reduce-motion setting: `useReducedMotion()` is true then, and
// the component snaps to its end state instead of animating there.

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
  const reduced = useReducedMotion();
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
        if (reduced) return;
        pressed.value = withSpring(1, { damping: 22, stiffness: 380, mass: 0.5 });
      }}
      onPressOut={() => {
        if (reduced) return;
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
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(index * step, withTiming(1, { duration: motion.enter, easing: Easing.out(Easing.cubic) }));
  }, [index, progress, step, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export function SkeletonBlock({ style, borderRadius = 8 }: { style?: StyleProp<ViewStyle>; borderRadius?: number }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(reduced ? 0.7 : 0.4);

  useEffect(() => {
    if (reduced) {
      pulse.value = 0.7;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduced]);

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
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const width = useSharedValue(target);

  useEffect(() => {
    if (reduced) {
      width.value = target;
      return;
    }
    width.value = withTiming(target, { duration: motion.slow, easing: Easing.out(Easing.cubic) });
  }, [target, width, reduced]);

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
  const reduced = useReducedMotion();
  const pulse = useSharedValue(reduced ? 1 : 0.35);

  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, animatedStyle]} />;
}

// The studio is working: a halo leaves the dot and fades, once every 1.8s. One shared value for
// scale and one for opacity, both on the UI thread, so a running pipeline costs nothing per frame.
export function LivePulse({ color = colors.success[300], size = 8 }: { color?: string; size?: number }) {
  const reduced = useReducedMotion();
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      sweep.value = 0;
      return;
    }
    sweep.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
  }, [sweep, reduced]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - sweep.value) * 0.5,
    transform: [{ scale: 1 + sweep.value * 1.6 }],
  }));

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={[{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color }, haloStyle]}
      />
      <View style={{ width: size * 0.6, height: size * 0.6, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

export interface ProgressRingProps {
  // 0–1 of the thing being drawn; the ring fills clockwise from twelve o'clock.
  ratio: number;
  size?: number;
  thickness?: number;
  tone?: string;
  trackColor?: string;
  // The surface the ring is cut out of. The hole is painted with it, which is how a ring is
  // drawn without SVG: two rotating half-discs, clipped, then punched.
  holeColor: string;
  children?: React.ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function ProgressRing({
  ratio,
  size = 40,
  thickness = 3,
  tone = colors.gold[300],
  trackColor = "rgba(242, 238, 228, 0.1)",
  holeColor,
  children,
  accessibilityLabel,
  style,
}: ProgressRingProps) {
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const rotation = ringRotation(target);
  const first = useSharedValue(reduced ? rotation.first : 0);
  const second = useSharedValue(reduced ? rotation.second : 0);

  useEffect(() => {
    if (reduced) {
      first.value = rotation.first;
      second.value = rotation.second;
      return;
    }
    first.value = withTiming(rotation.first, { duration: motion.slow, easing: Easing.out(Easing.cubic) });
    second.value = withTiming(rotation.second, { duration: motion.slow, easing: Easing.out(Easing.cubic) });
  }, [first, second, rotation.first, rotation.second, reduced]);

  // The right window shows the first 180°, the left window the second: a half-disc rotated
  // further out of its window reveals less of the sweep.
  const firstStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -size / 4 }, { rotate: `${first.value - 180}deg` }, { translateX: size / 4 }],
  }));
  // The second half starts fully hidden on the far side of the circle (a -180° turn puts the
  // disc outside the left window) and sweeps in from the bottom as the ratio passes 50%.
  const secondStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: size / 4 }, { rotate: `${second.value - 180}deg` }, { translateX: -size / 4 }],
  }));

  const halfDisc = { width: size / 2, height: size, backgroundColor: tone };
  const hole = size - thickness * 2;

  return (
    <View
      testID="progress-ring"
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
      style={[{ width: size, height: size }, style]}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: trackColor }]} />

      <View style={[styles.halfWindow, { left: size / 2, width: size / 2, height: size }]}>
        <Animated.View
          testID="ring-first"
          style={[halfDisc, { borderTopRightRadius: size / 2, borderBottomRightRadius: size / 2 }, firstStyle]}
        />
      </View>

      <View style={[styles.halfWindow, { left: 0, width: size / 2, height: size }]}>
        <Animated.View
          testID="ring-second"
          style={[halfDisc, { borderTopLeftRadius: size / 2, borderBottomLeftRadius: size / 2 }, secondStyle]}
        />
      </View>

      <View
        style={{
          position: "absolute",
          top: thickness,
          left: thickness,
          width: hole,
          height: hole,
          borderRadius: hole / 2,
          backgroundColor: holeColor,
        }}
      />

      {children ? <View style={styles.ringContent}>{children}</View> : null}
    </View>
  );
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
  halfWindow: { position: "absolute", top: 0, overflow: "hidden" },
  ringContent: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
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
