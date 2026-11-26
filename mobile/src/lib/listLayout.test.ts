import { fixedItemLayout, gridColumnWidth, gridItemLayout } from "@/lib/listLayout";

describe("gridItemLayout", () => {
  it("puts every card of a row at the row's offset", () => {
    const layout = gridItemLayout(2, 300, 24);
    expect(layout(null, 0)).toEqual({ index: 0, length: 324, offset: 0 });
    expect(layout(null, 1)).toEqual({ index: 1, length: 324, offset: 0 });
    expect(layout(null, 2)).toEqual({ index: 2, length: 324, offset: 324 });
    expect(layout(null, 3)).toEqual({ index: 3, length: 324, offset: 324 });
  });

  it("handles a single column", () => {
    const layout = gridItemLayout(1, 100, 8);
    expect(layout(null, 2).offset).toBe(216);
  });

  it("never divides by zero columns", () => {
    const layout = gridItemLayout(0, 100);
    expect(layout(null, 3).offset).toBe(300);
  });
});

describe("fixedItemLayout", () => {
  it("accumulates one row pitch per item", () => {
    const layout = fixedItemLayout(106, 8);
    expect(layout(null, 0).offset).toBe(0);
    expect(layout(null, 76)).toEqual({ index: 76, length: 114, offset: 76 * 114 });
  });
});

describe("gridColumnWidth", () => {
  it("subtracts the page padding and the gap between columns", () => {
    expect(gridColumnWidth(390, 20, 16)).toBe(167);
  });

  it("floors at zero for a window narrower than its own padding", () => {
    expect(gridColumnWidth(30, 20, 16)).toBe(0);
  });

  it("supports more than two columns", () => {
    expect(gridColumnWidth(400, 20, 10, 3)).toBeCloseTo(113.33, 1);
  });
});
