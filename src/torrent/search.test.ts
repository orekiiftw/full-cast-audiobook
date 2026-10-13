import { afterEach, expect, setSystemTime, test } from "bun:test";
import { buildTorrentSearchQueries, resetTorBoxSearchCircuit, searchTorBox, torBoxSearchDown } from "./search";
import { mockFetch, restoreFetchAndEnvironment } from "./testSupport";

const MINUTE_MS = 60_000;

afterEach(() => {
  setSystemTime();
  resetTorBoxSearchCircuit();
  restoreFetchAndEnvironment();
});

function mockTorBoxSearch(outcomes: Array<"unreachable" | "ok">): () => number {
  let calls = 0;
  mockFetch(async () => {
    if (outcomes[calls++] === "unreachable") throw new Error("Unable to connect");
    return new Response(JSON.stringify({ data: [{ name: "Dune epub", hash: "a".repeat(40), size: 1_000_000, seeds: 3 }] }), {
      status: 200,
    });
  });
  return () => calls;
}

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

test("an unreachable TorBox search pauses TorBox only until the pause ends", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const start = Date.now();
  setSystemTime(start);
  const calls = mockTorBoxSearch(["unreachable", "ok"]);

  await expect(searchTorBox("Dune epub")).rejects.toThrow("Unable to connect");
  await expect(searchTorBox("Dune epub")).rejects.toThrow("unreachable");
  expect(calls()).toBe(1);

  setSystemTime(start + 5 * MINUTE_MS);
  expect(torBoxSearchDown()).toBeNull();
  expect(await searchTorBox("Dune epub")).toHaveLength(1);
  expect(calls()).toBe(2);
});

test("repeated TorBox failures lengthen the pause and a success resets it", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const start = Date.now();
  const at = (minutes: number) => setSystemTime(start + minutes * MINUTE_MS);
  mockTorBoxSearch(["unreachable", "unreachable", "ok", "unreachable"]);

  at(0);
  await searchTorBox("Dune epub").catch(() => {});
  at(5);
  await searchTorBox("Dune epub").catch(() => {});
  at(14);
  expect(torBoxSearchDown()).not.toBeNull();
  at(15);
  expect(await searchTorBox("Dune epub")).toHaveLength(1);
  await searchTorBox("Dune epub").catch(() => {});
  at(20);
  expect(torBoxSearchDown()).toBeNull();
});
