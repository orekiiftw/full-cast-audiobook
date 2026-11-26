import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AppText } from "@/components/ui";
import { formatDurationWithHours } from "@/lib/format";
import { selectHaptic, tapHaptic } from "@/lib/haptics";
import { bubbleLeft, msAtRatio, ratioFromX, tickBucket } from "@/lib/scrubber";
import { usePlayer, usePlayerPosition } from "@/playback/PlayerProvider";
import { colors } from "@/theme/tokens";

// The chapter scrubber. Dragging it is a UI-thread gesture: the fill, the thumb and the time
// bubble are all driven by one shared value, so sixty move events a second never touch React.
// React hears about it exactly twice per drag — once when the drag starts, and once when the
// thumb crosses a tenth of the chapter, which is what fires the haptic tick. Releasing commits
// the seek through the player, which is where the chapter's lines are known.

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 14;
const BUBBLE_WIDTH = 62;

export function Scrubber() {
  const player = usePlayer();
  const { positionMs, chapterTotalMs, ratio } = usePlayerPosition();
  const reduced = useReducedMotion();

  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [bubbleMs, setBubbleMs] = useState(0);

  const dragRatio = useSharedValue(0);
  const draggingValue = useSharedValue(0);
  const displayRatio = useSharedValue(0);
  const widthValue = useSharedValue(0);

  const dragRatioRef = useRef(0);
  const bucketRef = useRef(0);
  const widthRef = useRef(0);

  widthRef.current = trackWidth;

  useEffect(() => {
    widthValue.value = trackWidth;
  }, [trackWidth, widthValue]);

  // The play head, whenever the listener is not the one moving it.
  useEffect(() => {
    if (dragging) return;
    if (reduced) displayRatio.value = ratio;
    else displayRatio.value = withTiming(ratio, { duration: 240, easing: Easing.out(Easing.quad) });
  }, [ratio, dragging, displayRatio, reduced]);

  const onTick = useCallback(() => selectHaptic(), []);

  // A thumb crossing a tenth of the chapter is the tick; the bubble's number follows the same
  // reaction so the two never disagree.
  useAnimatedReaction(
    () => (draggingValue.value > 0 ? Math.round(dragRatio.value * 10) : null),
    (bucket) => {
      if (bucket === null) return;
      if (bucket !== bucketRef.current) {
        bucketRef.current = bucket;
        runOnJS(onTick)();
      }
    },
  );

  useAnimatedReaction(
    () => (draggingValue.value > 0 ? Math.round(dragRatio.value * 100) : null),
    (percent) => {
      if (percent === null) return;
      runOnJS(setBubbleMs)(msAtRatio(chapterTotalMs, percent / 100));
    },
  );

  const begin = useCallback(
    (x: number) => {
      const next = ratioFromX(x, widthRef.current);
      dragRatio.value = next;
      dragRatioRef.current = next;
      bucketRef.current = tickBucket(next);
      draggingValue.value = 1;
      displayRatio.value = next;
      setBubbleMs(msAtRatio(chapterTotalMs, next));
      setDragging(true);
    },
    [chapterTotalMs, displayRatio, dragRatio, draggingValue],
  );

  const move = useCallback(
    (x: number) => {
      const reference = x > 0 ? x : dragRatioRef.current * widthRef.current;
      const next = ratioFromX(reference, widthRef.current);
      dragRatio.value = next;
      dragRatioRef.current = next;
      displayRatio.value = next;
    },
    [displayRatio, dragRatio],
  );

  const end = useCallback(() => {
    draggingValue.value = 0;
    setDragging(false);
    player.seekToRatio(dragRatioRef.current);
    tapHaptic();
  }, [draggingValue, player]);

  const responder = useMemo(() => {
    const locate = (event: { nativeEvent: { locationX?: number; pageX?: number } }, startRatio: number, startPageX: number) => {
      const local = event.nativeEvent.locationX;
      if (typeof local === "number" && Number.isFinite(local)) return local;
      const page = event.nativeEvent.pageX;
      if (typeof page === "number" && Number.isFinite(page)) {
        return (startRatio + (page - startPageX) / Math.max(1, widthRef.current)) * widthRef.current;
      }
      return 0;
    };

    let startPageX = 0;
    let startRatio = 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        startPageX = event.nativeEvent.pageX ?? 0;
        begin(locate(event, 0, startPageX));
        startRatio = dragRatioRef.current;
      },
      onPanResponderMove: (event) => {
        move(locate(event, startRatio, startPageX));
      },
      onPanResponderRelease: () => end(),
      onPanResponderTerminate: () => end(),
    });
  }, [begin, end, move]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, draggingValue.value > 0 ? dragRatio.value : displayRatio.value)) * 100}%`,
  }));

  const thumbStyle = useAnimatedStyle(() => {
    const current = Math.max(0, Math.min(1, draggingValue.value > 0 ? dragRatio.value : displayRatio.value));
    return { transform: [{ translateX: current * widthValue.value - THUMB_SIZE / 2 }] };
  });

  const bubbleStyle = useAnimatedStyle(() => {
    const current = Math.max(0, Math.min(1, dragRatio.value));
    const left = bubbleLeft(current, widthValue.value, BUBBLE_WIDTH);
    return {
      opacity: draggingValue.value,
      transform: [{ translateX: left - BUBBLE_WIDTH / 2 }, { translateY: -10 - draggingValue.value * 12 }],
    };
  });

  const onLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.wrapper}>
      <View
        {...responder.panHandlers}
        onLayout={onLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek within the chapter"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.max(0, Math.min(1, ratio)) * 100) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(action) => {
          const step = action.nativeEvent.actionName === "increment" ? 0.05 : -0.05;
          player.seekToRatio(Math.max(0, Math.min(1, ratio + step)));
        }}
        style={styles.trackHit}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
        <Animated.View style={[styles.thumb, thumbStyle]} />
        <Animated.View pointerEvents="none" style={[styles.bubble, bubbleStyle]}>
          <AppText variant="micro" mono tone="inverse">
            {formatDurationWithHours(bubbleMs)}
          </AppText>
        </Animated.View>
      </View>
      <View style={styles.timeRow}>
        <AppText variant="caption" tone={dragging ? "gold" : "tertiary"} mono>
          {formatDurationWithHours(dragging ? bubbleMs : positionMs)}
        </AppText>
        <AppText variant="caption" tone="tertiary" mono>
          {formatDurationWithHours(chapterTotalMs)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  trackHit: { paddingVertical: 12, justifyContent: "center" },
  track: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: "rgba(242, 238, 228, 0.08)", overflow: "hidden" },
  fill: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: colors.gold[400] },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.gold[200],
    top: 12 + TRACK_HEIGHT / 2 - THUMB_SIZE / 2,
  },
  bubble: {
    position: "absolute",
    width: BUBBLE_WIDTH,
    top: 0,
    borderRadius: 999,
    backgroundColor: colors.gold[300],
    paddingVertical: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
});
