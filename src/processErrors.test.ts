import { describe, expect, it } from "bun:test";

function runWithRejectionLogging(body: string) {
  const script = `import { logUnhandledRejections } from ${JSON.stringify(`${import.meta.dir}/processErrors.ts`)};
logUnhandledRejections();
${body}`;
  return Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
}

describe("logUnhandledRejections", () => {
  it("logs a stray rejection and keeps the process running", () => {
    const result = runWithRejectionLogging(`
void Promise.reject(new Error("stray failure"));
setTimeout(() => console.log("still serving"), 50);
`);

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("still serving");
    expect(result.stderr.toString()).toContain("Unhandled promise rejection:");
    expect(result.stderr.toString()).toContain("stray failure");
  });

  it("still exits non-zero when awaited startup work fails", () => {
    const result = runWithRejectionLogging(`
await Promise.reject(new Error("startup failed"));
console.log("started");
`);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).not.toContain("started");
    expect(result.stderr.toString()).toContain("startup failed");
  });
});
