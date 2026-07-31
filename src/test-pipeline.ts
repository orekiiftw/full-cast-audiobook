import { segmentChapter } from "./segmentService";
import { parseEpub } from "./epubService";
import {
  ensureWavBuffer,
  escapeFfmpegConcatPath,
  isSafeStorageKey,
  pcmToWav,
} from "./audioUtils";
import { SEGMENT } from "./lib/constants";

async function runTests() {
  console.log("🧪 Starting AI Audiobook Pipeline Diagnostics...");
  console.log("=================================================");

  // 1. Test Segmentation Engine
  console.log("\n1. Testing Segmenter Service...");
  const mockBlocks = [
    { type: "narration" as const, text: "This is the first sentence of the book. It sets up the atmosphere." },
    { type: "dialogue" as const, text: '"Hello there!" he said, walking towards the counter.' },
    { type: "narration" as const, text: "The receptionist looked up. She seemed tired." },
    { type: "dialogue" as const, text: '"Can I help you?"' },
    { type: "narration" as const, text: "He nodded. He explained his situation in detail, telling her about the storm, the car breaking down on the highway, and how he had walked for two miles in the freezing rain just to find some shelter." }
  ];

  const segments = segmentChapter(mockBlocks);
  console.log(`✅ Segmenter returned ${segments.length} segments.`);
  console.log(`   Segment 1 text length: ${segments[0]?.text.length || 0} characters.`);
  
  if (segments.length > 0) {
    console.log(`   Sample segment: "${segments[0].text}"`);
  }

  // Oversized run with no terminal punctuation must be hard-split
  const longWords = Array.from({ length: 650 }, (_, i) => `word${i}`).join(" ");
  const longSegs = segmentChapter([{ type: "narration" as const, text: longWords }]);
  const maxWordsInSeg = Math.max(
    ...longSegs.map((s) => s.text.trim().split(/\s+/).filter(Boolean).length),
    0
  );
  if (maxWordsInSeg > SEGMENT.HARD_MAX_WORDS) {
    throw new Error(
      `Oversized sentence bypassed hard cap: got ${maxWordsInSeg} words (cap ${SEGMENT.HARD_MAX_WORDS})`
    );
  }
  if (longSegs.length < 2) {
    throw new Error("Expected oversized text to produce multiple segments");
  }
  console.log(
    `✅ Oversized sentence hard-split into ${longSegs.length} segments (max ${maxWordsInSeg} words).`
  );

  // 2. Test FFmpeg Availability
  console.log("\n2. Testing Local FFmpeg Install...");
  try {
    const silenceProc = Bun.spawn(["ffmpeg", "-version"]);
    const exitCode = await silenceProc.exited;
    if (exitCode === 0) {
      console.log("✅ FFmpeg is installed and accessible.");
    } else {
      console.warn("⚠️ FFmpeg command returned non-zero status.");
    }
  } catch (err: any) {
    console.error("❌ FFmpeg is NOT installed or not accessible in path. Audio stitching will fail!");
    console.error(`   Error details: ${err.message}`);
  }

  try {
    const probeProc = Bun.spawn(["ffprobe", "-version"]);
    const exitCode = await probeProc.exited;
    if (exitCode === 0) {
      console.log("✅ FFprobe is installed and accessible.");
    } else {
      console.warn("⚠️ FFprobe command returned non-zero status.");
    }
  } catch (err: any) {
    console.error("❌ FFprobe is NOT installed or not accessible in path. Audio duration checks will fail!");
    console.error(`   Error details: ${err.message}`);
  }

  // 3. Test EPUB Parser logic (compilation check)
  console.log("\n3. Testing EPUB Parser Module...");
  try {
    if (typeof parseEpub === "function") {
      console.log("✅ EPUB parser module compiles and exports successfully.");
    }
  } catch (err: any) {
    console.error(`❌ EPUB parser failed verification: ${err.message}`);
  }

  // 4. Audio utils + storage key safety
  console.log("\n4. Testing audioUtils...");
  const fakePcm = Buffer.alloc(4800); // 100ms mono s16le @ 24kHz
  const wav = pcmToWav(fakePcm);
  if (wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("pcmToWav did not produce RIFF header");
  }
  const ensured = ensureWavBuffer(wav);
  if (ensured.length !== wav.length) {
    throw new Error("ensureWavBuffer re-wrapped an existing WAV");
  }
  if (isSafeStorageKey("../etc/passwd") || isSafeStorageKey("/abs/path") || !isSafeStorageKey("books/x/seg.wav")) {
    throw new Error("isSafeStorageKey validation failed");
  }
  if (escapeFfmpegConcatPath("/tmp/oreki's/seg.wav") !== "/tmp/oreki'\\''s/seg.wav") {
    throw new Error("escapeFfmpegConcatPath failed to escape single quotes");
  }
  console.log("✅ audioUtils OK.");

  console.log("\n=================================================");
  console.log("🎉 Pipeline diagnostics complete. All code compiled successfully.");
}

runTests().catch(console.error);
