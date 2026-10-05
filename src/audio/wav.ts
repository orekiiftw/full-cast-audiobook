const DEFAULT_SAMPLE_RATE = 24000;

const DEFAULT_CHANNELS = 1;

const DEFAULT_BITS_PER_SAMPLE = 16;

const SILENCE_PEAK_THRESHOLD = 0.015;

const SILENCE_WINDOW_MS = 10;

export function pcmToWav(
  pcm: Buffer,
  sampleRate = DEFAULT_SAMPLE_RATE,
  channels = DEFAULT_CHANNELS,
  bitsPerSample = DEFAULT_BITS_PER_SAMPLE,
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

export function ensureWavBuffer(audio: Buffer): Buffer {
  if (!audio || audio.length === 0) {
    throw new Error("Empty audio buffer from TTS");
  }
  if (isWavBuffer(audio)) {
    return audio;
  }
  return pcmToWav(audio);
}

interface ParsedWav {
  pcm: Buffer;
  audioFormat: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export function parseWav(buf: Buffer): ParsedWav {
  if (!isWavBuffer(buf)) {
    throw new Error("Not a RIFF/WAVE buffer");
  }

  let audioFormat: number | null = null;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  const dataChunks: Buffer[] = [];

  let offset = 12;
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

export function concatWavs(buffers: Buffer[]): { wav: Buffer; durationMs: number } {
  if (buffers.length === 0) {
    throw new Error("No audio buffers to concatenate");
  }
  if (buffers.length === 1) {
    const single = parseWav(buffers[0]);
    return { wav: buffers[0], durationMs: pcmDurationMs(single, single.pcm.length) };
  }

  const parsed = buffers.map(parseWav);
  const first = parsed[0];
  if (first.audioFormat !== 1) {
    throw new Error(`Unsupported WAV audio format ${first.audioFormat} (only PCM=1)`);
  }
  for (const wav of parsed) {
    const matchesFirst =
      wav.audioFormat === first.audioFormat &&
      wav.sampleRate === first.sampleRate &&
      wav.channels === first.channels &&
      wav.bitsPerSample === first.bitsPerSample;
    if (!matchesFirst) {
      throw new Error("Mismatched WAV formats cannot be concatenated in memory");
    }
  }

  const pcm = Buffer.concat(parsed.map((wav) => wav.pcm));
  return {
    wav: pcmToWav(pcm, first.sampleRate, first.channels, first.bitsPerSample),
    durationMs: pcmDurationMs(first, pcm.length),
  };
}

interface PcmLayout {
  pcm: Buffer;
  frameBytes: number;
  bytesPerSample: number;
  channels: number;
}

export function trimWavSilence(wav: Buffer, keepMs = 40, threshold = SILENCE_PEAK_THRESHOLD): Buffer {
  let parsed: ParsedWav;
  try {
    parsed = parseWav(wav);
  } catch {
    return wav;
  }
  if (parsed.audioFormat !== 1 || parsed.bitsPerSample !== 16) return wav;

  const { pcm, sampleRate, channels, bitsPerSample } = parsed;
  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = channels * bytesPerSample;
  const frames = Math.floor(pcm.length / frameBytes);
  if (frames === 0) return wav;

  const layout: PcmLayout = { pcm, frameBytes, bytesPerSample, channels };
  const windowFrames = Math.max(1, Math.round((sampleRate * SILENCE_WINDOW_MS) / 1000));
  let firstAudibleFrame = -1;
  let lastAudibleEnd = -1;
  for (let start = 0; start < frames; start += windowFrames) {
    const end = Math.min(start + windowFrames, frames);
    let windowPeak = 0;
    for (let frame = start; frame < end; frame++) {
      const peak = framePeak(layout, frame);
      if (peak > windowPeak) windowPeak = peak;
    }
    if (windowPeak > threshold) {
      if (firstAudibleFrame < 0) firstAudibleFrame = start;
      lastAudibleEnd = end;
    }
  }
  if (firstAudibleFrame < 0) return wav;

  const keepFrames = Math.max(0, Math.round((sampleRate * keepMs) / 1000));
  const from = Math.max(0, firstAudibleFrame - keepFrames);
  const to = Math.min(frames, lastAudibleEnd + keepFrames);
  if (from === 0 && to === frames) return wav;

  return pcmToWav(pcm.subarray(from * frameBytes, to * frameBytes), sampleRate, channels, bitsPerSample);
}

export function silenceWav(
  durationSec: number,
  sampleRate = DEFAULT_SAMPLE_RATE,
  channels = DEFAULT_CHANNELS,
  bitsPerSample = DEFAULT_BITS_PER_SAMPLE,
): Buffer {
  const bytes = Math.max(0, Math.round(durationSec * sampleRate * channels * (bitsPerSample / 8)));
  return pcmToWav(Buffer.alloc(bytes), sampleRate, channels, bitsPerSample);
}

function isWavBuffer(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}

function pcmDurationMs(format: ParsedWav, pcmLength: number): number {
  const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8);
  if (bytesPerSecond <= 0) {
    return 0;
  }
  return Math.round((pcmLength / bytesPerSecond) * 1000);
}

function framePeak(layout: PcmLayout, frame: number): number {
  let peak = 0;
  for (let channel = 0; channel < layout.channels; channel++) {
    const value = Math.abs(layout.pcm.readInt16LE(frame * layout.frameBytes + channel * layout.bytesPerSample) / 32768);
    if (value > peak) peak = value;
  }
  return peak;
}
