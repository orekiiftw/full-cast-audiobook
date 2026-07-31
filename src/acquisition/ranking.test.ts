import { expect, test } from "bun:test";
import { normalizeSearchQuery, rankBooks, scoreBook } from "./ranking";
import { BookResult } from "./types";

const epub: BookResult = { id: "epub", provider: "test", title: "The Left Hand of Darkness", authors: ["Ursula K. Le Guin"], isbn: "9780441478125", language: "en", format: "epub", filesize: 1_000_000, mirrors: [] };
const pdf: BookResult = { ...epub, id: "pdf", format: "pdf", title: "A Different Book", isbn: undefined };

test("ranking prioritizes ISBN, exact title, preferred language, and EPUB", () => {
  const ranked = rankBooks([pdf, epub], { title: "The Left Hand of Darkness", author: "Le Guin", isbn: "9780441478125", languages: ["en"], formats: ["epub", "pdf"] });
  expect(ranked.map((book) => book.id)).toEqual(["epub", "pdf"]);
  expect(ranked[0].score).toBeGreaterThan(scoreBook(pdf, { title: "The Left Hand of Darkness" }));
});

test("normalized cache keys are invariant to case and punctuation", () => {
  expect(normalizeSearchQuery({ title: "The Left-Hand of Darkness!", author: "LE GUIN" })).toBe(normalizeSearchQuery({ title: "the left hand of darkness", author: "le guin" }));
});
