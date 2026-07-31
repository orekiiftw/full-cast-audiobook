/**
 * Helpers for converting Gemini TTS raw PCM payloads into playable WAV files.
 * Gemini often returns s16le PCM without a container; ffmpeg and browsers need WAV/MP3.
 */

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_BITS_PER_SAMPLE = 16;

/**
 * Returns true if buffer already looks like a RIFF/WAVE file.
 */
export function isWavBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  );
}

/**
 * Wraps raw PCM (s16le) bytes in a minimal WAV header.
 */
export function pcmToWav(
  pcm: Buffer,
  sampleRate = DEFAULT_SAMPLE_RATE,
  channels = DEFAULT_CHANNELS,
  bitsPerSample = DEFAULT_BITS_PER_SAMPLE
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Ensures audio buffer is a valid WAV. If already WAV, returns as-is.
 * Otherwise treats input as raw s16le PCM and wraps it.
 */
export function ensureWavBuffer(audio: Buffer): Buffer {
  if (!audio || audio.length === 0) {
    throw new Error("Empty audio buffer from TTS");
  }
  if (isWavBuffer(audio)) {
    return audio;
  }
  return pcmToWav(audio);
}

/**
 * Escapes a filesystem path for an FFmpeg concat demuxer list entry
 * (`file '...'`). Single quotes in the path become `'\''`.
 */
export function escapeFfmpegConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

export interface ParsedWav {
  pcm: Buffer;
  audioFormat: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/**
 * Parses a RIFF/WAVE buffer into its PCM payload and format fields by walking
 * the chunk list (handles LIST/fact/other chunks and word-aligned padding).
 * Throws on anything that is not a well-formed PCM-family WAV.
 */
export function parseWav(buf: Buffer): ParsedWav {
  if (!isWavBuffer(buf)) {
    throw new Error("Not a RIFF/WAVE buffer");
  }

  let audioFormat: number | null = null;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  const dataChunks: Buffer[] = [];

  let offset = 12; // skip "RIFF" + size + "WAVE"
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (dataStart + chunkSize > buf.length) {
      throw new Error(`Truncated WAV chunk "${chunkId}"`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new Error("WAV fmt chunk too small");
      audioFormat = buf.readUInt16LE(dataStart);
      channels = buf.readUInt16LE(dataStart + 2);
      sampleRate = buf.readUInt32LE(dataStart + 4);
      bitsPerSample = buf.readUInt16LE(dataStart + 14);
    } else if (chunkId === "data") {
      dataChunks.push(buf.subarray(dataStart, dataStart + chunkSize));
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (audioFormat === null || dataChunks.length === 0) {
    throw new Error("WAV is missing a fmt or data chunk");
  }

  return {
    pcm: dataChunks.length === 1 ? dataChunks[0] : Buffer.concat(dataChunks),
    audioFormat,
    sampleRate,
    channels,
    bitsPerSample,
  };
}

/**
 * Concatenates same-format PCM WAV buffers in memory — no ffmpeg spawn.
 * All inputs must share sample rate / channel count / bit depth / format tag
 * (true for beats coming from a single TTS provider call pattern).
 * Throws on malformed or mismatched input so callers can fall back to ffmpeg.
 */
export function concatWavs(buffers: Buffer[]): { wav: Buffer; durationMs: number } {
  if (buffers.length === 0) {
    throw new Error("No audio buffers to concatenate");
  }
  if (buffers.length === 1) {
    const single = parseWav(buffers[0]);
    const bytesPerSec = single.sampleRate * single.channels * (single.bitsPerSample / 8);
    return {
      wav: buffers[0],
      durationMs: bytesPerSec > 0 ? Math.round((single.pcm.length / bytesPerSec) * 1000) : 0,
    };
  }

  const parsed = buffers.map(parseWav);
  const first = parsed[0];
  if (first.audioFormat !== 1) {
    // Only plain PCM is safe to splice raw; extensible/float formats go
    // through the ffmpeg fallback instead of risking corrupt output.
    throw new Error(`Unsupported WAV audio format ${first.audioFormat} (only PCM=1)`);
  }
  for (const p of parsed) {
    if (
      p.audioFormat !== first.audioFormat ||
      p.sampleRate !== first.sampleRate ||
      p.channels !== first.channels ||
      p.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("Mismatched WAV formats cannot be concatenated in memory");
    }
  }

  const pcm = Buffer.concat(parsed.map((p) => p.pcm));
  const bytesPerSec = first.sampleRate * first.channels * (first.bitsPerSample / 8);
  return {
    wav: pcmToWav(pcm, first.sampleRate, first.channels, first.bitsPerSample),
    durationMs: bytesPerSec > 0 ? Math.round((pcm.length / bytesPerSec) * 1000) : 0,
  };
}

/**
 * Builds a silent PCM WAV of the given duration in memory — replaces the
 * ffmpeg anullsrc spawns previously used to create stitch gap files.
 */
export function silenceWav(
  durationSec: number,
  sampleRate = DEFAULT_SAMPLE_RATE,
  channels = DEFAULT_CHANNELS,
  bitsPerSample = DEFAULT_BITS_PER_SAMPLE
): Buffer {
  const bytes = Math.max(0, Math.round(durationSec * sampleRate * channels * (bitsPerSample / 8)));
  return pcmToWav(Buffer.alloc(bytes), sampleRate, channels, bitsPerSample);
}

/**
 * Validates storage object keys used by /api/audio.
 * Rejects path traversal, absolute paths, and unexpected characters.
 */
export function isSafeStorageKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (key.length > 512) return false;
  if (key.includes("..")) return false;
  if (key.startsWith("/") || key.startsWith("\\")) return false;
  // Allow alphanumeric, slash, underscore, dash, dot
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key)) return false;
  return true;
}
