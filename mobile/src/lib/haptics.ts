import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// Haptics are a native courtesy, not a requirement: on web every call is a no-op, and on a
// device that refuses (or a build without the module) a rejection must never surface.

const enabled = Platform.OS !== "web";

function fire(run: () => Promise<void>): void {
  if (!enabled) return;
  run().catch(() => undefined);
}

// A primary action taken: search submitted, result picked, chapter started.
export function tapHaptic(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// A press inside a list or a segmented switch.
export function selectHaptic(): void {
  fire(() => Haptics.selectionAsync());
}

// The studio finished something worth noticing: a chapter is playable, the book is ready.
export function successHaptic(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

// A failure the user must see: the pipeline stopped, the add was refused.
export function errorHaptic(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
