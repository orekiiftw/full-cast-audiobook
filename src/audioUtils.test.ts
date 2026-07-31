import { expect, test } from "bun:test";
import { concatWavs, parseWav, pcmToWav, silenceWav } from "./audioUtils";

const RATE = 24000;
const BYTES_PER_SEC = RATE * 1 * 2; // mono s16le

test("parseWav round-trips pcmToWav output", () => {
  const pcm = Buffer.alloc(4800, 1); // 100ms
  const wav = pcmToWav(pcm);
  const parsed = parseWav(wav);
  expect(parsed.audioFormat).toBe(1);
  expect(parsed.sampleRate).toBe(RATE);
  expect(parsed.channels).toBe(1);
  expect(parsed.bitsPerSample).toBe(16);
  expect(parsed.pcm.length).toBe(4800);
});

test("parseWav skips unknown chunks and word-aligned padding", () => {
  const base = pcmToWav(Buffer.alloc(9600)); // 200ms
  // Insert an odd-sized JUNK chunk (3 bytes + 1 pad) between fmt and data
  const junkHeader = Buffer.alloc(8);
  junkHeader.write("JUNK", 0);
  junkHeader.writeUInt32LE(3, 4);
  const junkData = Buffer.from([1, 2, 3, 0]);
  const withJunk = Buffer.concat([
    base.subarray(0, 36), // through end of fmt chunk
    junkHeader,
    junkData,
    base.subarray(36), // "data" chunk onward
  ]);
  withJunk.writeUInt32LE(base.readUInt32LE(4) + junkHeader.length + junkData.length, 4);
  const parsed = parseWav(withJunk);
  expect(parsed.pcm.length).toBe(9600);
});

test("concatWavs merges PCM and computes duration", () => {
  const a = pcmToWav(Buffer.alloc(BYTES_PER_SEC)); // 1s
  const b = pcmToWav(Buffer.alloc(BYTES_PER_SEC / 2)); // 0.5s
  const { wav, durationMs } = concatWavs([a, b]);
  expect(durationMs).toBe(1500);
  const parsed = parseWav(wav);
  expect(parsed.pcm.length).toBe(BYTES_PER_SEC + BYTES_PER_SEC / 2);
  expect(parsed.sampleRate).toBe(RATE);
});

test("concatWavs returns single input as-is", () => {
  const a = pcmToWav(Buffer.alloc(BYTES_PER_SEC / 4));
  const { wav, durationMs } = concatWavs([a]);
  expect(wav).toBe(a);
  expect(durationMs).toBe(250);
});

test("concatWavs rejects empty input and non-WAV buffers", () => {
  expect(() => concatWavs([])).toThrow();
  expect(() => concatWavs([Buffer.from("not a wav at all...........")])).toThrow();
});

test("concatWavs rejects mismatched formats", () => {
  const mono = pcmToWav(Buffer.alloc(4800));
  const stereo = pcmToWav(Buffer.alloc(4800), RATE, 2);
  expect(() => concatWavs([mono, stereo])).toThrow(/Mismatched/);
});

test("concatWavs rejects truncated WAV chunks", () => {
  const wav = pcmToWav(Buffer.alloc(4800));
  const truncated = wav.subarray(0, wav.length - 100);
  // Header still claims full size → parser must throw, not silently slice
  expect(() => parseWav(truncated)).toThrow(/Truncated/);
});

test("silenceWav builds a valid silent WAV of the requested duration", () => {
  const wav = silenceWav(0.35);
  const parsed = parseWav(wav);
  expect(parsed.pcm.length).toBe(Math.round(0.35 * BYTES_PER_SEC));
  expect(parsed.pcm.every((b) => b === 0)).toBe(true);
  const { durationMs } = concatWavs([wav]);
  expect(durationMs).toBe(350);
});
