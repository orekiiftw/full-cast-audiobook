import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { downloadFileToPath, uploadFile } from "../storage/r2";
import { AUDIO } from "../lib/constants";
import { escapeFfmpegConcatPath, getAudioDurationMs, runProcess, DEFAULT_COMMAND_TIMEOUT_MS } from "./ffmpeg";
import { silenceWav } from "./wav";

const MAX_STITCH_TIMEOUT_MS = 60 * 60_000;

const MAX_CHAPTER_STITCH_BYTES = 4 * 1024 * 1024 * 1024;

const STITCH_BYTES_PER_SECOND = 48_000;

const DOWNLOAD_CONCURRENCY = 8;

const STANDARD_GAP_FILE = "silence_350.wav";

const SCENE_BREAK_GAP_FILE = "silence_700.wav";

const CONCAT_LIST_FILE = "concat_list.txt";

const FINAL_MP3_FILE = "chapter_final.mp3";

interface StitchSegmentInput {
  audioR2Key: string;
  isSceneBreak: boolean;
}

export async function stitchChapter(
  bookId: string,
  chapterIndex: number,
  segments: StitchSegmentInput[],
): Promise<{ r2Key: string; durationMs: number }> {
  console.log(`🎬 Stitching ${segments.length} segments for Book ${bookId} Chapter ${chapterIndex}...`);

  const workDir = await fs.mkdtemp(path.join(tmpdir(), "stitch_"));

  try {
    await writeGapFiles(workDir);
    const downloaded = await downloadSegments(segments, workDir);
    await writeConcatList(segments, downloaded.fileNames, workDir);
    const chapterPath = await encodeChapter(workDir, downloaded.totalBytes);
    const result = await uploadChapter(chapterPath, bookId, chapterIndex);

    console.log(`✅ Stitched chapter complete. Duration: ${(result.durationMs / 1000).toFixed(1)}s, Key: ${result.r2Key}`);
    return result;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeGapFiles(workDir: string): Promise<void> {
  await fs.writeFile(path.join(workDir, STANDARD_GAP_FILE), silenceWav(AUDIO.STANDARD_GAP_MS / 1000));
  await fs.writeFile(path.join(workDir, SCENE_BREAK_GAP_FILE), silenceWav(AUDIO.SCENE_BREAK_GAP_MS / 1000));
}

interface DownloadedSegments {
  fileNames: (string | null)[];
  totalBytes: number;
}

async function downloadSegments(segments: StitchSegmentInput[], workDir: string): Promise<DownloadedSegments> {
  const fileNames: (string | null)[] = new Array(segments.length).fill(null);
  let totalBytes = 0;

  for (let start = 0; start < segments.length; start += DOWNLOAD_CONCURRENCY) {
    await Promise.all(
      segments.slice(start, start + DOWNLOAD_CONCURRENCY).map(async (segment, offset) => {
        const index = start + offset;
        if (!segment.audioR2Key) {
          console.warn(`⚠️ Segment ${index} has no audio key. Skipping in stitch.`);
          return;
        }

        const fileName = `seg_${index}_raw.wav`;
        totalBytes += await downloadFileToPath(segment.audioR2Key, path.join(workDir, fileName));
        if (totalBytes > MAX_CHAPTER_STITCH_BYTES) {
          throw new Error(`Chapter audio exceeds the ${MAX_CHAPTER_STITCH_BYTES / (1024 * 1024 * 1024)}GB stitch budget.`);
        }
        fileNames[index] = fileName;
      }),
    );
  }

  return { fileNames, totalBytes };
}

async function writeConcatList(segments: StitchSegmentInput[], fileNames: (string | null)[], workDir: string): Promise<void> {
  const concatLines = buildConcatLines(segments, fileNames);
  if (concatLines.length === 0) {
    throw new Error("No valid segments could be stitched for this chapter.");
  }

  await fs.writeFile(path.join(workDir, CONCAT_LIST_FILE), concatLines.join("\n"));
}

function buildConcatLines(segments: StitchSegmentInput[], fileNames: (string | null)[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    const fileName = fileNames[index];
    if (!fileName) continue;

    if (index > 0) {
      const gapFile = segments[index - 1]?.isSceneBreak ? SCENE_BREAK_GAP_FILE : STANDARD_GAP_FILE;
      lines.push(`file '${escapeFfmpegConcatPath(gapFile)}'`);
    }
    lines.push(`file '${escapeFfmpegConcatPath(fileName)}'`);
  }
  return lines;
}

async function encodeChapter(workDir: string, stitchedBytes: number): Promise<string> {
  const args = [
    "ffmpeg",
    "-f",
    "concat",
    "-i",
    CONCAT_LIST_FILE,
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:a",
    "libmp3lame",
    "-b:a",
    AUDIO.CHAPTER_BITRATE,
    "-ac",
    String(AUDIO.CHAPTER_CHANNELS),
    FINAL_MP3_FILE,
    "-y",
  ];

  const concatResult = await runProcess(args, stitchTimeoutMs(stitchedBytes), workDir);
  if (!concatResult.success) {
    throw new Error(`Stitching compilation failed: ${concatResult.stderr}`);
  }
  return path.join(workDir, FINAL_MP3_FILE);
}

function stitchTimeoutMs(stitchedBytes: number): number {
  const scaledTimeoutMs = Math.ceil(stitchedBytes / STITCH_BYTES_PER_SECOND / 60) * 60_000;
  return Math.max(DEFAULT_COMMAND_TIMEOUT_MS, Math.min(MAX_STITCH_TIMEOUT_MS, scaledTimeoutMs));
}

async function uploadChapter(chapterPath: string, bookId: string, chapterIndex: number): Promise<{ r2Key: string; durationMs: number }> {
  const durationMs = await getAudioDurationMs(chapterPath);
  const r2Key = `books/${bookId}/chapters/chapter_${chapterIndex}.mp3`;
  await uploadFile(r2Key, await fs.readFile(chapterPath), "audio/mpeg");
  return { r2Key, durationMs };
}
