import { describe, expect, it } from "bun:test";

// The harness replaces the db, queue, storage, and narration modules for everything it loads, so it runs in its own process.
if (process.env.SEGMENT_RECOVERY_HARNESS_CHILD === "1") {
  await import("./segmentRecovery.testSupport");
} else {
  describe("recovering segments whose execution died, in an isolated pipeline", () => {
    it("re-claims a stalled segment and bounds how often the sweep requeues one", () => {
      const result = Bun.spawnSync([process.execPath, "test", import.meta.path], {
        env: { ...process.env, SEGMENT_RECOVERY_HARNESS_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    });
  });
}
