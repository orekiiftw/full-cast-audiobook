import type { Book } from "@/api/types";
import { BOOK_SEED_TTL_MS, clearBookSeeds, forgetBookSeed, readBookSeed, rememberBookSeed, rememberBookSeeds } from "@/lib/bookSeed";

function book(id: string, title = "A Title"): Book {
  return {
    id,
    title,
    author: "An Author",
    coverR2Key: null,
    sourceHash: `hash-${id}`,
    epubR2Key: null,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("book seeds", () => {
  beforeEach(() => clearBookSeeds());

  it("hands the library row back to the detail screen", () => {
    rememberBookSeed(book("b1", "The Left Hand of Darkness"));
    expect(readBookSeed("b1")?.title).toBe("The Left Hand of Darkness");
  });

  it("returns null for a book it never saw", () => {
    expect(readBookSeed("nope")).toBeNull();
    expect(readBookSeed(undefined)).toBeNull();
  });

  it("drops a seed older than the TTL rather than painting a stale row", () => {
    const at = 1_000;
    rememberBookSeed(book("b1"), at);
    expect(readBookSeed("b1", at + BOOK_SEED_TTL_MS)?.id).toBe("b1");
    expect(readBookSeed("b1", at + BOOK_SEED_TTL_MS + 1)).toBeNull();
    expect(readBookSeed("b1", at + BOOK_SEED_TTL_MS + 2)).toBeNull();
  });

  it("forgets a deleted book", () => {
    rememberBookSeed(book("b1"));
    forgetBookSeed("b1");
    expect(readBookSeed("b1")).toBeNull();
  });

  it("seeds a whole list at once", () => {
    rememberBookSeeds([book("b1"), book("b2")]);
    expect(readBookSeed("b2")?.id).toBe("b2");
  });
});
