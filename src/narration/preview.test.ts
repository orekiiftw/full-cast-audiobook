import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as database from "../db";
import * as queue from "../queue";
import * as tts from "./tts";
import * as voiceContext from "./voiceContext";
import { getVoicePreview } from "./preview";
import type { castMembers } from "../schema";

type CastMemberRow = typeof castMembers.$inferSelect;

// Mocks patch the loaded modules for the rest of the test process, so put the real exports back afterwards.
const originals = { database: { ...database }, queue: { ...queue }, tts: { ...tts }, voiceContext: { ...voiceContext } };
afterAll(() => {
  mock.module("../db", () => originals.database);
  mock.module("../queue", () => originals.queue);
  mock.module("./tts", () => originals.tts);
  mock.module("./voiceContext", () => originals.voiceContext);
});

const CAST_ID = "00000000-0000-0000-0000-000000000040";
const VOICE_KEY = "Mia::warm and wry";
const SYNTHESIZED = Buffer.from("fresh preview");

let castRow: CastMemberRow;
let speakCalls = 0;
let speak: () => Promise<Buffer> = async () => SYNTHESIZED;
const heldLocks = new Map<string, string>();

function storedRow(overrides: Partial<CastMemberRow> = {}): CastMemberRow {
  return {
    id: CAST_ID,
    bookId: "00000000-0000-0000-0000-000000000041",
    name: "Narrator",
    aliases: [],
    importance: "main",
    voiceBucket: "female_adult",
    ttsVoiceName: "Mia",
    styleString: "warm and wry",
    pronunciationNotes: null,
    previewAudio: null,
    previewVoiceKey: null,
    previewGen: 0,
    ...overrides,
  };
}

mock.module("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ ...castRow }] }) }),
    update: () => ({
      set: (payload: Partial<CastMemberRow>) => ({
        where: async () => {
          if (payload.previewGen === castRow.previewGen + 1) castRow = { ...castRow, ...payload };
        },
      }),
    }),
  },
}));
mock.module("../queue", () => ({
  acquireLock: async (name: string) => {
    if (heldLocks.has(name)) return null;
    heldLocks.set(name, `tok:${name}`);
    return `tok:${name}`;
  },
  releaseLock: async (name: string, token: string) => {
    if (heldLocks.get(name) === token) heldLocks.delete(name);
  },
  isLockHeld: async (name: string) => heldLocks.has(name),
}));
mock.module("./voiceContext", () => ({
  getBookVoiceContext: async () => ({ language: "en" }),
}));
mock.module("./tts", () => ({
  getTTSProvider: () => ({
    speak: async () => {
      speakCalls++;
      return speak();
    },
  }),
}));

beforeEach(() => {
  castRow = storedRow();
  speakCalls = 0;
  speak = async () => SYNTHESIZED;
  heldLocks.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("getVoicePreview single-flight", () => {
  it("synthesizes once for concurrent requests and hands every caller the same audio", async () => {
    const pending = deferred<Buffer>();
    speak = () => pending.promise;
    const staleRow = storedRow();

    const requests = Promise.all([1, 2, 3].map(() => getVoicePreview(staleRow, CAST_ID)));
    await Bun.sleep(20);
    pending.resolve(SYNTHESIZED);
    const previews = await requests;

    expect(speakCalls).toBe(1);
    expect(previews.map((preview) => preview?.toString())).toEqual(["fresh preview", "fresh preview", "fresh preview"]);
    expect(castRow.previewVoiceKey).toBe(VOICE_KEY);
    expect(castRow.previewGen).toBe(1);
    expect(heldLocks.size).toBe(0);
  });

  it("does not retry synthesis for waiting requests when the first attempt fails", async () => {
    const pending = deferred<Buffer>();
    speak = () => pending.promise;

    const requests = Promise.all([1, 2, 3].map(() => getVoicePreview(storedRow(), CAST_ID)));
    await Bun.sleep(20);
    pending.reject(new Error("TTS provider unavailable"));

    expect(await requests).toEqual([null, null, null]);
    expect(speakCalls).toBe(1);
    expect(heldLocks.size).toBe(0);
  });

  it("reuses a preview stored after the caller read the cast row", async () => {
    castRow = storedRow({ previewAudio: Buffer.from("stored preview").toString("base64"), previewVoiceKey: VOICE_KEY, previewGen: 1 });

    const preview = await getVoicePreview(storedRow(), CAST_ID);

    expect(preview?.toString()).toBe("stored preview");
    expect(speakCalls).toBe(0);
  });

  it("re-synthesizes when the stored preview is for a different voice", async () => {
    castRow = storedRow({ previewAudio: Buffer.from("old voice").toString("base64"), previewVoiceKey: "Leo::gruff", previewGen: 3 });

    const preview = await getVoicePreview(storedRow({ previewVoiceKey: "Leo::gruff", previewGen: 3 }), CAST_ID);

    expect(preview?.toString()).toBe("fresh preview");
    expect(speakCalls).toBe(1);
    expect(castRow.previewVoiceKey).toBe(VOICE_KEY);
    expect(castRow.previewGen).toBe(4);
  });
});
