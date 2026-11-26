import { DRAG_DISMISS_DISTANCE, dragOffset, isDismissDrag, shouldDismissSheet } from "@/lib/sheetGesture";

describe("bottom sheet gesture", () => {
  it("claims a downward drag and ignores a sideways one", () => {
    expect(isDismissDrag(20, 2)).toBe(true);
    expect(isDismissDrag(3, 0)).toBe(false);
    expect(isDismissDrag(10, 40)).toBe(false);
    expect(isDismissDrag(-40, 0)).toBe(false);
  });

  it("dismisses past the distance threshold or on a fast flick", () => {
    expect(shouldDismissSheet(DRAG_DISMISS_DISTANCE + 1, 0)).toBe(true);
    expect(shouldDismissSheet(40, 0.95)).toBe(true);
    expect(shouldDismissSheet(40, 0.2)).toBe(false);
  });

  it("never lets the sheet ride above its resting position", () => {
    expect(dragOffset(-30)).toBe(0);
    expect(dragOffset(54)).toBe(54);
  });
});
