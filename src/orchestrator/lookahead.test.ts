import { describe, expect, it } from "bun:test";

if (process.env.CHAPTER_BUFFER_CHILD === "1") {
  await import("./lookahead.testSupport");
} else {
  describe("chapter buffer isolated pipeline regressions", () => {
    for (const lookahead of ["", "5"]) {
      it(`enforces the ${lookahead || "default four"}-chapter buffer across automatic paths`, () => {
        const result = Bun.spawnSync([process.execPath, "test", import.meta.path], {
          env: { ...process.env, CHAPTER_LOOKAHEAD: lookahead, CHAPTER_BUFFER_CHILD: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.exitCode, result.stderr.toString()).toBe(0);
      });
    }
  });
}
