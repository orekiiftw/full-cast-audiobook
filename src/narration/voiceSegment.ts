import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { getTTSProvider, isRetryableError } from "./tts";
import { escapeFfmpegConcatPath, runProcess } from "../audio/ffmpeg";
import { concatWavs, parseWav, silenceWav, trimWavSilence } from "../audio/wav";
import { AUDIO } from "../lib/constants";

export interface VoiceBeat {
  text: string;
  delivery?: {
    style?: string;
    emotion?: string;
    intensity?: number;
    pace?: string;
  };
}

export interface VoiceSegmentOptions {
  narratorVoice: string;
  narratorBaseStyle: string;
  pDict: Record<string, string>;
  language?: string | null;
  instruction?: string;
  onBeatStart?: (index: number, total: number) => void;
  tempDirPrefix: string;
}

export interface VoicedSegmentAudio {
  wav: Buffer;
  durationMs: number;
}

interface BeatDelivery {
  style: string;
  emotion: string;
  intensity: number;
  pace: string;
}

interface Pcm16Format {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

const FFMPEG_TIMEOUT_MS = 60_000;
const FFPROBE_TIMEOUT_MS = 15_000;
const MAX_INSTRUCTION_CHARS = 500;
const NEUTRAL_RETRY_DELIVERY: BeatDelivery = {
  style: "natural",
  emotion: "steady narrative flow",
  intensity: 0.3,
  pace: "normal",
};

export async function synthesizeSegmentAudio(beats: VoiceBeat[], opts: VoiceSegmentOptions): Promise<VoicedSegmentAudio> {
  if (beats.length === 0) {
    throw new Error("No beats available for TTS");
  }

  const audioBuffers = await Promise.all(
    beats.map((beat, index) => {
      opts.onBeatStart?.(index, beats.length);
      return synthesizeBeat(beat, opts);
    }),
  );

  const pieces = mergeBeatsWithPauses(beats, audioBuffers);

  try {
    return concatWavs(pieces);
  } catch (err) {
    console.warn("⚠️ In-memory beat concat failed; falling back to ffmpeg merge.", err);
    return concatBeatsWithFfmpeg(pieces, opts.tempDirPrefix);
  }
}

export function mergeBeatsWithPauses(beats: VoiceBeat[], audioBuffers: Buffer[]): Buffer[] {
  const format = commonPcm16Format(audioBuffers);
  if (!format) return audioBuffers;

  const trimmed = audioBuffers.map((buffer) => trimWavSilence(buffer, AUDIO.EDGE_SILENCE_KEEP_MS));
  const pause = (ms: number) => silenceWav(ms / 1000, format.sampleRate, format.channels, format.bitsPerSample);

  const pieces: Buffer[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (i > 0) {
      const previousText = beats[i - 1]?.text ?? "";
      pieces.push(pause(endsAtSentenceBoundary(previousText) ? AUDIO.BEAT_GAP_MS : AUDIO.BEAT_GAP_SOFT_MS));
    }
    pieces.push(trimmed[i]);
  }
  pieces.push(pause(AUDIO.SEGMENT_TAIL_PAUSE_MS));
  return pieces;
}

async function synthesizeBeat(beat: VoiceBeat, opts: VoiceSegmentOptions): Promise<Buffer> {
  const provider = getTTSProvider(opts.language);
  const delivery = resolveBeatDelivery(beat);

  try {
    const stylePrompt = buildStylePrompt(opts.narratorBaseStyle, delivery, opts.instruction);
    return await provider.speak(beat.text, opts.narratorVoice, stylePrompt, opts.pDict, {
      pace: delivery.pace,
      intensity: delivery.intensity,
    });
  } catch (beatError) {
    if (!isRetryableError(beatError)) throw beatError;
    console.warn("⚠️ Beat failed with emotional style; retrying neutral.", beatError);
    const neutralPrompt = buildStylePrompt(opts.narratorBaseStyle, NEUTRAL_RETRY_DELIVERY);
    return provider.speak(beat.text, opts.narratorVoice, neutralPrompt, opts.pDict, {
      pace: NEUTRAL_RETRY_DELIVERY.pace,
    });
  }
}

function resolveBeatDelivery(beat: VoiceBeat): BeatDelivery {
  return {
    style: beat.delivery?.style || "natural",
    emotion: beat.delivery?.emotion || "normal tone",
    intensity: beat.delivery?.intensity ?? 0.5,
    pace: beat.delivery?.pace || "normal",
  };
}

function buildStylePrompt(baseStyle: string, delivery: BeatDelivery, instruction?: string): string {
  const prompt = `${baseStyle}, speaking in a ${delivery.style} voice with ${delivery.emotion} (emotion intensity: ${delivery.intensity}, pacing: ${delivery.pace})`;
  if (!instruction) return prompt;
  return `${prompt}. Adjust performance: ${sanitizeInstruction(instruction)}`;
}

function sanitizeInstruction(instruction: string): string {
  return instruction
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_INSTRUCTION_CHARS);
}

async function concatBeatsWithFfmpeg(audioBuffers: Buffer[], tempDirPrefix: string): Promise<VoicedSegmentAudio> {
  const workDir = await fs.mkdtemp(path.join(tmpdir(), tempDirPrefix));
  try {
    const concatFilePath = await writeConcatManifest(workDir, audioBuffers);
    const finalSegmentPath = path.join(workDir, "segment_final.wav");
    const concatResult = await runProcess(
      ["ffmpeg", "-f", "concat", "-safe", "0", "-i", concatFilePath, "-c:a", "pcm_s16le", finalSegmentPath, "-y"],
      FFMPEG_TIMEOUT_MS,
    );
    if (!concatResult.success) {
      throw new Error(`FFmpeg concatenation of beats failed: ${concatResult.stderr}`);
    }

    const durationMs = await probeDurationMs(finalSegmentPath);
    const wav = await fs.readFile(finalSegmentPath);
    return { wav, durationMs };
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
}

async function writeConcatManifest(workDir: string, audioBuffers: Buffer[]): Promise<string> {
  const beatPaths: string[] = [];
  for (let i = 0; i < audioBuffers.length; i++) {
    const beatPath = path.join(workDir, `beat_${i}.wav`);
    await fs.writeFile(beatPath, audioBuffers[i]);
    beatPaths.push(beatPath);
  }

  const concatFilePath = path.join(workDir, "concat.txt");
  const concatLines = beatPaths.map((beatPath) => `file '${escapeFfmpegConcatPath(beatPath)}'`);
  await fs.writeFile(concatFilePath, concatLines.join("\n"));
  return concatFilePath;
}

async function probeDurationMs(filePath: string): Promise<number> {
  const probeResult = await runProcess(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    FFPROBE_TIMEOUT_MS,
  );

  if (!probeResult.success || !probeResult.stdout.trim()) {
    console.warn(`ffprobe duration failed (exit ${probeResult.exitCode}): ${probeResult.stderr}`);
    return 0;
  }
  const durationSec = parseFloat(probeResult.stdout.trim());
  return isNaN(durationSec) ? 0 : Math.round(durationSec * 1000);
}

function endsAtSentenceBoundary(text: string): boolean {
  return /[.!?।॥…]["'”’»)\]]*$/u.test(text.trim());
}

function commonPcm16Format(buffers: Buffer[]): Pcm16Format | null {
  const formats = buffers.map((buffer) => {
    try {
      const parsed = parseWav(buffer);
      return parsed.audioFormat === 1 && parsed.bitsPerSample === 16
        ? { sampleRate: parsed.sampleRate, channels: parsed.channels, bitsPerSample: parsed.bitsPerSample }
        : null;
    } catch {
      return null;
    }
  });

  const [first, ...rest] = formats;
  if (!first) return null;
  const matchesFirst = (format: Pcm16Format | null) =>
    !!format &&
    format.sampleRate === first.sampleRate &&
    format.channels === first.channels &&
    format.bitsPerSample === first.bitsPerSample;
  return rest.every(matchesFirst) ? first : null;
}
