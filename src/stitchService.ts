import { downloadFile, uploadFile } from "./r2";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { AUDIO } from "./lib/constants";
import { escapeFfmpegConcatPath, silenceWav } from "./audioUtils";

/**
 * Runs a command as a child process using Bun.spawn.
 * stdout and stderr are drained CONCURRENTLY: reading one stream to
 * completion before starting the other can deadlock the child when its
 * stderr pipe buffer fills (ffmpeg is chatty on malformed input).
 * A hard timeout kills the process so a pathological file can't hold a
 * worker indefinitely.
 */
const DEFAULT_CMD_TIMEOUT_MS = 5 * 60_000;
async function runCommand(args: string[], timeoutMs: number = DEFAULT_CMD_TIMEOUT_MS): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const proc = Bun.spawn(args);
  const timer = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* already exited */ }
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, success: exitCode === 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Queries the duration of an audio file in milliseconds using ffprobe
 */
async function getAudioDurationMs(filePath: string): Promise<number> {
  const args = [
    "ffprobe",
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ];
  const { stdout, success, stderr } = await runCommand(args);
  if (!success) {
    throw new Error(`FFprobe duration check failed: ${stderr}`);
  }
  const durationSeconds = parseFloat(stdout.trim());
  if (isNaN(durationSeconds)) {
    throw new Error(`Invalid duration output from ffprobe: ${stdout}`);
  }
  return Math.round(durationSeconds * 1000);
}

interface StitchSegmentInput {
  audioR2Key: string;
  isSceneBreak: boolean;
}

/**
 * Stitches multiple segments together into a single, normalized, chapter MP3 file.
 *
 * Cost profile: ONE ffmpeg pass total. The previous implementation normalized
 * every segment with its own ffmpeg process (N spawns per chapter) and
 * generated gap silence via anullsrc (2 more). Loudness normalization now runs
 * once on the concatenated chapter — the correct unit for uniform program
 * loudness — and silence files are built in memory.
 */
export async function stitchChapter(
  bookId: string,
  chapterIndex: number,
  segments: StitchSegmentInput[]
): Promise<{ r2Key: string; durationMs: number }> {
  console.log(`🎬 Stitching ${segments.length} segments for Book ${bookId} Chapter ${chapterIndex}...`);

  // Unpredictable temp dir name (defense-in-depth vs. symlink races). The
  // "stitch_" prefix lets the boot sweep recognize orphaned dirs.
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "stitch_"));
  await fs.mkdir(workDir, { recursive: true });

  const tempFilesToClean: string[] = [];

  try {
    // 1. Create the silence files in memory (350ms standard gap, 700ms scene
    // break gap) — same 24kHz mono s16le format as the TTS segment WAVs so
    // the concat demuxer accepts the mix.
    const silence350Path = path.join(workDir, "silence_350.wav");
    const silence700Path = path.join(workDir, "silence_700.wav");
    await fs.writeFile(silence350Path, silenceWav(AUDIO.STANDARD_GAP_MS / 1000));
    await fs.writeFile(silence700Path, silenceWav(AUDIO.SCENE_BREAK_GAP_MS / 1000));
    tempFilesToClean.push(silence350Path, silence700Path);

    // 2. Download segments in bounded-parallel batches (remote storage makes
    // serialized downloads the dominant stitch cost: N round-trips before
    // ffmpeg could even start), then build the concat list in strict order.
    // A per-chapter byte budget stops a pathological book (5,000 segments of
    // large WAVs) from exhausting worker memory/disk and retry-looping.
    const MAX_CHAPTER_STITCH_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
    const concatListFilePath = path.join(workDir, "concat_list.txt");
    const DOWNLOAD_CONCURRENCY = 8;
    const rawSegPaths: (string | null)[] = new Array(segments.length).fill(null);
    let stitchedBytes = 0;

    for (let start = 0; start < segments.length; start += DOWNLOAD_CONCURRENCY) {
      await Promise.all(
        segments.slice(start, start + DOWNLOAD_CONCURRENCY).map(async (seg, offset) => {
          const i = start + offset;

          // If segment is failed/missing, we skip it but do NOT crash the stitch
          if (!seg.audioR2Key) {
            console.warn(`⚠️ Segment ${i} has no audio key. Skipping in stitch.`);
            return;
          }

          const rawSegPath = path.join(workDir, `seg_${i}_raw.wav`);
          const rawBytes = await downloadFile(seg.audioR2Key);
          stitchedBytes += rawBytes.length;
          if (stitchedBytes > MAX_CHAPTER_STITCH_BYTES) {
            throw new Error(
              `Chapter audio exceeds the ${MAX_CHAPTER_STITCH_BYTES / (1024 * 1024 * 1024)}GB stitch budget.`
            );
          }
          await fs.writeFile(rawSegPath, rawBytes);
          tempFilesToClean.push(rawSegPath);
          rawSegPaths[i] = rawSegPath;
        })
      );
    }

    const concatLines: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const rawSegPath = rawSegPaths[i];
      if (!rawSegPath) continue;

      // Insert silence gap — escape single quotes for FFmpeg concat demuxer.
      // isSceneBreak is set on the segment that ENDS a scene (segmentService
      // flags the buffer flushed at the divider), so the long pause belongs
      // between the flagged segment and the NEXT one — i.e. before the segment
      // that follows it. Reading the flag on segments[i] itself used to place
      // the 700ms pause before the scene's final paragraph instead.
      if (i > 0) {
        if (segments[i - 1]?.isSceneBreak) {
          concatLines.push(`file '${escapeFfmpegConcatPath(silence700Path)}'`);
        } else {
          concatLines.push(`file '${escapeFfmpegConcatPath(silence350Path)}'`);
        }
      }

      concatLines.push(`file '${escapeFfmpegConcatPath(rawSegPath)}'`);
    }

    if (concatLines.length === 0) {
      throw new Error("No valid segments could be stitched for this chapter.");
    }

    // Write the concat list file
    await fs.writeFile(concatListFilePath, concatLines.join("\n"));
    tempFilesToClean.push(concatListFilePath);

    // 3. Single ffmpeg pass: concat + loudness normalize + encode the final
    // 128kbps stereo chapter MP3
    const finalMp3Path = path.join(workDir, "chapter_final.mp3");
    const concatArgs = [
      "ffmpeg",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListFilePath,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "libmp3lame",
      "-b:a", AUDIO.CHAPTER_BITRATE,
      "-ac", String(AUDIO.CHAPTER_CHANNELS), // convert to stereo
      finalMp3Path,
      "-y"
    ];

    const concatResult = await runCommand(concatArgs);
    if (!concatResult.success) {
      throw new Error(`Stitching compilation failed: ${concatResult.stderr}`);
    }
    tempFilesToClean.push(finalMp3Path);

    // 4. Extract final stitched file duration
    const durationMs = await getAudioDurationMs(finalMp3Path);

    // 5. Upload final chapter MP3 to R2
    const finalR2Key = `books/${bookId}/chapters/chapter_${chapterIndex}.mp3`;
    const finalBytes = await fs.readFile(finalMp3Path);
    await uploadFile(finalR2Key, finalBytes, "audio/mpeg");

    console.log(`✅ Stitched chapter complete. Duration: ${(durationMs / 1000).toFixed(1)}s, Key: ${finalR2Key}`);
    return {
      r2Key: finalR2Key,
      durationMs,
    };
  } finally {
    // 6. Clean up all temporary files and directory
    for (const filePath of tempFilesToClean) {
      try {
        await fs.unlink(filePath);
      } catch {
        // file already deleted or doesn't exist
      }
    }
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // directory deleted
    }
  }
}
