import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { getTTSProvider, isRetryableError } from "../ttsService";
import { concatWavs, escapeFfmpegConcatPath } from "../audioUtils";

/**
 * Beat shape required for synthesis. Compatible with BeatAnnotation from
 * annotationService (delivery fields are all optional/defensive here).
 */
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
  /** Optional free-form performance adjustment (segment regeneration). */
  instruction?: string;
  /** Fired right before each beat's TTS call (index, total). */
  onBeatStart?: (index: number, total: number) => void;
  /** Prefix for the fallback temp dir so the boot sweep recognizes orphans. */
  tempDirPrefix: string;
}

export interface VoicedSegmentAudio {
  wav: Buffer;
  durationMs: number;
}

/**
 * Synthesizes one beat with an emotional style, retrying once with a neutral
 * style when the emotional delivery fails (content filters, model errors).
 */
async function synthesizeBeat(
  beat: VoiceBeat,
  opts: VoiceSegmentOptions
): Promise<Buffer> {
  const emotionPrompt = beat.delivery?.emotion || "normal tone";
  const style = beat.delivery?.style || "natural";
  const intensity = beat.delivery?.intensity ?? 0.5;
  const pace = beat.delivery?.pace || "normal";
  let combinedStylePrompt = `${opts.narratorBaseStyle}, speaking in a ${style} voice with ${emotionPrompt} (emotion intensity: ${intensity}, pacing: ${pace})`;
  if (opts.instruction) {
    combinedStylePrompt = `${combinedStylePrompt}. Adjust performance: ${opts.instruction}`;
  }

  try {
    return await getTTSProvider().speak(beat.text, opts.narratorVoice, combinedStylePrompt, opts.pDict);
  } catch (beatErr) {
    // Permanent errors (missing API key, 400/401/403/422 content rejection)
    // can never be fixed by a neutral-style retry — rethrow so the real
    // diagnostic error surfaces instead of doubling the paid synthesis.
    if (!isRetryableError(beatErr)) throw beatErr;
    console.warn("⚠️ Beat failed with emotional style; retrying neutral.", beatErr);
    const neutralStylePrompt = `${opts.narratorBaseStyle}, speaking in a natural voice with steady narrative flow (emotion intensity: 0.3, pacing: normal)`;
    return getTTSProvider().speak(beat.text, opts.narratorVoice, neutralStylePrompt, opts.pDict);
  }
}

/**
 * Fallback beat merge via ffmpeg for beats that can't be spliced in memory
 * (non-PCM or mismatched WAV containers).
 */

/** Max wall-clock time for a single ffmpeg/ffprobe subprocess. */
const FFMPEG_TIMEOUT_MS = 60_000;
const FFPROBE_TIMEOUT_MS = 15_000;

async function concatBeatsWithFfmpeg(
  audioBuffers: Buffer[],
  tempDirPrefix: string
): Promise<VoicedSegmentAudio> {
  // Unpredictable temp dir name (defense-in-depth vs. symlink races on shared
  // hosts). The prefix lets the boot sweep recognize orphans.
  const workDir = await fs.mkdtemp(path.join(tmpdir(), tempDirPrefix));
  try {
    const tempBeatFiles: string[] = [];
    for (let i = 0; i < audioBuffers.length; i++) {
      const beatFilePath = path.join(workDir, `beat_${i}.wav`);
      await fs.writeFile(beatFilePath, audioBuffers[i]);
      tempBeatFiles.push(beatFilePath);
    }

    const concatFilePath = path.join(workDir, "concat.txt");
    const concatLines = tempBeatFiles.map((f) => `file '${escapeFfmpegConcatPath(f)}'`);
    await fs.writeFile(concatFilePath, concatLines.join("\n"));

    const finalSegmentPath = path.join(workDir, "segment_final.wav");
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-f", "concat",
        "-safe", "0",
        "-i", concatFilePath,
        "-c:a", "pcm_s16le",
        finalSegmentPath,
        "-y",
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    // Drain stdout and stderr CONCURRENTLY with the exit promise: reading
    // one stream to completion before starting the other deadlocks the child
    // when its pipe buffer fills (ffmpeg is chatty on malformed input).
    const ffmpegTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already exited */ }
    }, FFMPEG_TIMEOUT_MS);
    let ffmpegStderr: string;
    let ffmpegExit: number;
    try {
      [, ffmpegStderr, ffmpegExit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
    } finally {
      clearTimeout(ffmpegTimer);
    }
    if (ffmpegExit !== 0) {
      throw new Error(`FFmpeg concatenation of beats failed: ${ffmpegStderr}`);
    }

    const durationProc = Bun.spawn(
      [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        finalSegmentPath,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const probeTimer = setTimeout(() => {
      try { durationProc.kill("SIGKILL"); } catch { /* already exited */ }
    }, FFPROBE_TIMEOUT_MS);
    let durationText: string;
    let durationStderr: string;
    let durationExit: number;
    try {
      [durationText, durationStderr, durationExit] = await Promise.all([
        new Response(durationProc.stdout).text(),
        new Response(durationProc.stderr).text(),
        durationProc.exited,
      ]);
    } finally {
      clearTimeout(probeTimer);
    }
    let durationMs: number;
    if (durationExit !== 0 || !durationText.trim()) {
      console.warn(`ffprobe duration failed (exit ${durationExit}): ${durationStderr}`);
      durationMs = 0;
    } else {
      const durationSec = parseFloat(durationText.trim());
      durationMs = isNaN(durationSec) ? 0 : Math.round(durationSec * 1000);
    }

    const wav = await fs.readFile(finalSegmentPath);
    return { wav, durationMs };
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Voices a whole segment: all beats are synthesized CONCURRENTLY (the global
 * TTS slot limiter in ttsService still bounds in-flight requests account-wide,
 * so this parallelizes latency without raising upstream pressure), then merged
 * in memory. One misbehaving beat only falls back for that beat; one
 * unparseable WAV only falls back the merge, not the synthesis.
 */
export async function synthesizeSegmentAudio(
  beats: VoiceBeat[],
  opts: VoiceSegmentOptions
): Promise<VoicedSegmentAudio> {
  if (beats.length === 0) {
    throw new Error("No beats available for TTS");
  }

  const audioBuffers = await Promise.all(
    beats.map((beat, i) => {
      opts.onBeatStart?.(i, beats.length);
      return synthesizeBeat(beat, opts);
    })
  );

  try {
    return concatWavs(audioBuffers);
  } catch (err) {
    console.warn("⚠️ In-memory beat concat failed; falling back to ffmpeg merge.", err);
    return concatBeatsWithFfmpeg(audioBuffers, opts.tempDirPrefix);
  }
}
