import { expect, test } from "bun:test";
import { normalizeSearchQuery, rankBooks, scoreBook } from "./ranking";
import { BookResult } from "./types";

const epub: BookResult = {
  id: "epub",
  provider: "test",
  title: "The Left Hand of Darkness",
  authors: ["Ursula K. Le Guin"],
  isbn: "9780441478125",
  language: "en",
  format: "epub",
  filesize: 1_000_000,
  mirrors: [],
};
const pdf: BookResult = { ...epub, id: "pdf", format: "pdf", title: "A Different Book", isbn: undefined };

test("ranking prioritizes ISBN, exact title, preferred language, and EPUB", () => {
  const ranked = rankBooks([pdf, epub], {
    title: "The Left Hand of Darkness",
    author: "Le Guin",
    isbn: "9780441478125",
    languages: ["en"],
    formats: ["epub", "pdf"],
  });
  expect(ranked.map((book) => book.id)).toEqual(["epub", "pdf"]);
  expect(ranked[0].score).toBeGreaterThan(scoreBook(pdf, { title: "The Left Hand of Darkness" }));
});

test("normalized cache keys are invariant to case and punctuation", () => {
  expect(normalizeSearchQuery({ title: "The Left-Hand of Darkness!", author: "LE GUIN" })).toBe(
    normalizeSearchQuery({ title: "the left hand of darkness", author: "le guin" }),
  );
});

test("ranking preserves non-Latin titles: exact CJK match outranks unrelated Latin", () => {
  const zh: BookResult = { ...epub, id: "zh", title: "三体", authors: ["刘慈欣"], language: "zh", isbn: undefined };
  const unrelatedLatin: BookResult = {
    ...epub,
    id: "latin",
    title: "Vingt mille lieues sous les mers",
    authors: ["Jules Verne"],
    language: "fr",
    isbn: undefined,
  };
  const ranked = rankBooks([unrelatedLatin, zh], { title: "三体" });
  expect(ranked[0].id).toBe("zh");
});

test("normalized cache keys preserve non-Latin text (no collapse to empty)", () => {
  const zh = normalizeSearchQuery({ title: "三体", author: "刘慈欣" });
  expect(zh).toContain("三体");
  expect(normalizeSearchQuery({ title: "三体" })).toBe(normalizeSearchQuery({ title: "三体 " }));
});

test("MARC/ISO-639-2 language codes earn the bonus against 639-1 preferences", () => {
  const marc: BookResult = { ...epub, id: "marc", language: "eng" };
  const other: BookResult = { ...epub, id: "other", language: "fre", isbn: undefined };
  const ranked = rankBooks([other, marc], { title: "The Left Hand of Darkness" });
  expect(ranked[0].id).toBe("marc");
  expect(ranked[0].score).toBeGreaterThan(scoreBook(other, { title: "The Left Hand of Darkness" }));
});

test("title tokens match whole words, not substrings", () => {
  const machinery: BookResult = { ...epub, id: "machinery", title: "Machinery of the Gods", isbn: undefined, filesize: 0 };
  const unrelated: BookResult = { ...epub, id: "unrelated", title: "Completely Unrelated", isbn: undefined, filesize: 0 };
  const exact: BookResult = { ...epub, id: "exact", title: "The Time Machine", isbn: undefined };
  const ranked = rankBooks([machinery, exact], { title: "The Time Machine" });
  expect(ranked[0].id).toBe("exact");
  const machineryScore = scoreBook(machinery, { title: "The Time Machine" });
  const exactScore = scoreBook(exact, { title: "The Time Machine" });
  expect(machineryScore).toBeLessThan(exactScore);
  expect(machineryScore).toBe(scoreBook(unrelated, { title: "The Time Machine" }));
});

test("identical ISBNs from different providers dedup to the highest-scored occurrence", () => {
  const torrentCopy: BookResult = { ...epub, id: "torrent-copy", provider: "torrent", format: "pdf" };
  const ranked = rankBooks([torrentCopy, epub], { title: "The Left Hand of Darkness" });
  const isbns = ranked.filter((book) => book.isbn === epub.isbn);
  expect(isbns).toHaveLength(1);
  expect(isbns[0].id).toBe("epub");
});
