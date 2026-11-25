// FlatList's `getItemLayout`, as arithmetic. Both lists in the app are fixed-pitch — the
// library grid's cards reserve a two-line title and a status slot, and a chapter row reserves
// its two-line title so the ring always sits in the same place — which means a scroll to any of
// 77 chapters can jump straight to an offset instead of measuring its way there.

export interface ListItemLayout {
  index: number;
  length: number;
  offset: number;
}

export type GetItemLayout = (data: unknown, index: number) => ListItemLayout;

// `itemHeight` is one card's height, `rowGap` the vertical space after each row.
export function gridItemLayout(columns: number, itemHeight: number, rowGap = 0): GetItemLayout {
  const rowPitch = itemHeight + rowGap;
  return (_data, index) => ({
    index,
    length: rowPitch,
    offset: rowPitch * Math.floor(index / Math.max(1, columns)),
  });
}

// A single-column list where every row is the same height.
export function fixedItemLayout(itemHeight: number, rowGap = 0): GetItemLayout {
  const rowPitch = itemHeight + rowGap;
  return (_data, index) => ({ index, length: rowPitch, offset: rowPitch * index });
}

// The card width for a two-column grid inside `horizontalPadding` on both sides.
export function gridColumnWidth(windowWidth: number, horizontalPadding: number, columnGap: number, columns = 2): number {
  const usable = windowWidth - horizontalPadding * 2 - columnGap * (columns - 1);
  return Math.max(0, usable / columns);
}
