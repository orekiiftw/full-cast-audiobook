import { expect, test } from "bun:test";
import { mergeBeatsWithPauses } from "./voiceSegment";
import { concatWavs, pcmToWav } from "../audio/wav";

const RATE = 24000;
const BYTES_PER_SECOND_MONO_S16 = RATE * 2;
const WAV_FORMAT_TAG_OFFSET = 20;
const IEEE_FLOAT_FORMAT_TAG = 3;

function beatWav(sampleRate = RATE, channels = 1): Buffer {
  const silence = Buffer.alloc(Math.round(sampleRate * 0.3) * channels * 2);
  const speech = Buffer.alloc(sampleRate * channels * 2, 0x70);
  return pcmToWav(Buffer.concat([silence, speech, silence]), sampleRate, channels);
}

function assembledMs(beats: { text: string }[], buffers = beats.map(() => beatWav())): number {
  return concatWavs(mergeBeatsWithPauses(beats, buffers)).durationMs;
}

test("mergeBeatsWithPauses trims beat edges and splices sentence, soft, and tail pauses", () => {
  const beats = [{ text: "He walked to the door." }, { text: "and then," }, { text: "he left!" }];
  expect(assembledMs(beats)).toBe(1080 * 3 + 350 + 100 + 350);
});

test("mergeBeatsWithPauses keeps a trailing pause and builds it in the beat's own format", () => {
  expect(assembledMs([{ text: "Alone at last." }], [beatWav(44100, 2)])).toBe(1080 + 350);
});

test("mergeBeatsWithPauses gives a mid-sentence split only a breath", () => {
  expect(assembledMs([{ text: "He said" }, { text: "hello, old friend." }])).toBe(1080 * 2 + 100 + 350);
});

test("mergeBeatsWithPauses reads a danda and a quote-closed period as sentence ends", () => {
  const danda = [{ text: "राम घर गया।" }, { text: "तब वह चला।" }];
  expect(assembledMs(danda)).toBe(1080 * 2 + 350 + 350);

  const quoted = [{ text: 'She said "stop."' }, { text: "He stopped." }];
  expect(assembledMs(quoted)).toBe(1080 * 2 + 350 + 350);
});

test("mergeBeatsWithPauses does not add edge silence to a trimmed beat", () => {
  const speechOnly = pcmToWav(Buffer.alloc(BYTES_PER_SECOND_MONO_S16, 0x70));
  expect(concatWavs(mergeBeatsWithPauses([{ text: "Tight." }], [speechOnly])).durationMs).toBe(1000 + 350);
});

test("mergeBeatsWithPauses passes unmergeable beats through untouched for the ffmpeg fallback", () => {
  const floats = pcmToWav(Buffer.alloc(BYTES_PER_SECOND_MONO_S16, 0x70));
  floats.writeUInt16LE(IEEE_FLOAT_FORMAT_TAG, WAV_FORMAT_TAG_OFFSET);
  const buffers = [floats, pcmToWav(Buffer.alloc(BYTES_PER_SECOND_MONO_S16, 0x70))];
  expect(mergeBeatsWithPauses([{ text: "One." }, { text: "Two." }], buffers)).toEqual(buffers);
});
