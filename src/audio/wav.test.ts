import { expect, test } from "bun:test";
import { concatWavs, parseWav, pcmToWav, silenceWav, trimWavSilence } from "./wav";

const RATE = 24000;
const BYTES_PER_SEC = RATE * 1 * 2;

test("parseWav round-trips pcmToWav output", () => {
  const pcm = Buffer.alloc(4800, 1);
  const wav = pcmToWav(pcm);
  const parsed = parseWav(wav);
  expect(parsed.audioFormat).toBe(1);
  expect(parsed.sampleRate).toBe(RATE);
  expect(parsed.channels).toBe(1);
  expect(parsed.bitsPerSample).toBe(16);
  expect(parsed.pcm.length).toBe(4800);
});

test("parseWav skips unknown chunks and word-aligned padding", () => {
  const base = pcmToWav(Buffer.alloc(9600));
  const junkHeader = Buffer.alloc(8);
  junkHeader.write("JUNK", 0);
  junkHeader.writeUInt32LE(3, 4);
  const junkData = Buffer.from([1, 2, 3, 0]);
  const withJunk = Buffer.concat([base.subarray(0, 36), junkHeader, junkData, base.subarray(36)]);
  withJunk.writeUInt32LE(base.readUInt32LE(4) + junkHeader.length + junkData.length, 4);
  const parsed = parseWav(withJunk);
  expect(parsed.pcm.length).toBe(9600);
});

test("concatWavs merges PCM and computes duration", () => {
  const a = pcmToWav(Buffer.alloc(BYTES_PER_SEC));
  const b = pcmToWav(Buffer.alloc(BYTES_PER_SEC / 2));
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

test("trimWavSilence strips edge silence but keeps the requested tail", () => {
  const silence = Buffer.alloc(BYTES_PER_SEC / 2);
  const speech = Buffer.alloc(BYTES_PER_SEC, 0x70);
  const trimmed = trimWavSilence(pcmToWav(Buffer.concat([silence, speech, silence])), 40);
  const parsed = parseWav(trimmed);
  expect(parsed.pcm.length).toBe(Math.round(1.08 * BYTES_PER_SEC));
  expect(parsed.sampleRate).toBe(RATE);
  expect(parsed.channels).toBe(1);
});

test("trimWavSilence leaves already-tight audio untouched and never empties a buffer", () => {
  const tight = pcmToWav(Buffer.alloc(BYTES_PER_SEC, 0x70));
  expect(trimWavSilence(tight, 40).length).toBe(tight.length);

  const silent = pcmToWav(Buffer.alloc(BYTES_PER_SEC));
  expect(trimWavSilence(silent, 40).length).toBe(silent.length);

  const notWav = Buffer.from("not a wav at all...........");
  expect(trimWavSilence(notWav, 40).length).toBe(notWav.length);
});
