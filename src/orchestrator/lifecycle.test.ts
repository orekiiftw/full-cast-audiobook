import { describe, expect, it } from "bun:test";

// The harness replaces the db, queue, and storage modules for everything it loads, so it runs in its own process.
if (process.env.LIFECYCLE_HARNESS_CHILD === "1") {
  await import("./lifecycle.testSupport");
} else {
  describe("book retry and deletion in an isolated pipeline", () => {
    it("retries and deletes books without losing user data, racing the sweep, or leaving files behind", () => {
      const result = Bun.spawnSync([process.execPath, "test", import.meta.path], {
        env: { ...process.env, LIFECYCLE_HARNESS_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    });
  });
}
