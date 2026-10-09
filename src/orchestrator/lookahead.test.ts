import { describe, expect, it } from "bun:test";

// Each window size runs in its own process: PIPELINE reads LOOKAHEAD_SEGMENTS once at import time,
// and the harness replaces the db and queue modules for everything it loads.
if (process.env.LOOKAHEAD_WINDOW_CHILD === "1") {
  await import("./lookahead.testSupport");
} else {
  describe("section lookahead window in an isolated pipeline", () => {
    for (const lookahead of ["", "5"]) {
      it(`holds the window at the anchor plus ${lookahead || "the default four"} sections across every automatic path`, () => {
        const result = Bun.spawnSync([process.execPath, "test", import.meta.path], {
          env: { ...process.env, LOOKAHEAD_SEGMENTS: lookahead, LOOKAHEAD_WINDOW_CHILD: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.exitCode, result.stderr.toString()).toBe(0);
      });
    }
  });
}
