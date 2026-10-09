import { initEventBridge, pingRedis, scheduleSweep, startWorkers } from "../queue";
import { runIngestionJob } from "./ingestion";
import { runSegmentJob } from "./segment";
import { runStitchJob } from "./stitch";
import { runPipelineSweep } from "./sweep";
import { resumePendingWork } from "./recovery";

export { queueBookIngestion } from "./ingestion";
export { restitchChapterInBackground } from "./stitch";
export { deleteBook, retryFailedBook } from "./lifecycle";
export { ensureLookahead } from "./lookahead";

export async function startPipeline(): Promise<void> {
  await pingRedis();
  await initEventBridge();

  try {
    await resumePendingWork();
  } catch (err) {
    console.error("❌ Boot recovery failed (the periodic sweep will retry it):", err);
  }

  startWorkers({
    ingest: runIngestionJob,
    voice: runSegmentJob,
    stitch: runStitchJob,
    sweep: async () => {
      try {
        await runPipelineSweep();
      } catch (err) {
        console.error("Pipeline sweep failed (will run again on schedule):", err);
      }
    },
  });

  await scheduleSweep();
  console.log("🧵 Durable pipeline workers started (BullMQ/Redis).");
}
