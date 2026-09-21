import { expect, test } from "bun:test";
import { buildTorrentSearchQueries } from "./search";

test("buildTorrentSearchQueries normalizes initials and adds surname fallback", () => {
  expect(buildTorrentSearchQueries("Harry Potter and the Philosopher's Stone", "J.K. Rowling")).toEqual([
    "Harry Potter and the Philosopher s Stone J K Rowling epub",
    "Harry Potter and the Philosopher s Stone Rowling epub",
    "Harry Potter and the Philosopher s Stone epub",
    "Harry Potter Philosopher Stone Rowling epub",
    "Harry Potter epub",
  ]);
});

test("buildTorrentSearchQueries removes duplicate variants for a minimal query", () => {
  expect(buildTorrentSearchQueries("Dune", "Herbert")).toEqual(["Dune Herbert epub", "Dune epub"]);
});

test("buildTorrentSearchQueries preserves non-Latin titles instead of returning []", () => {
  const zh = buildTorrentSearchQueries("战争与和平", "托尔斯泰");
  expect(zh.length).toBeGreaterThan(0);
  expect(zh[0]).toContain("战争与和平");
  const cy = buildTorrentSearchQueries("Преступление и наказание", "Достоевский");
  expect(cy.length).toBeGreaterThan(0);
  expect(cy[0]).toContain("Преступление и наказание");
  const de = buildTorrentSearchQueries("गोदान", "");
  expect(de.length).toBeGreaterThan(0);
  expect(de[0]).toContain("गोदान");
});
