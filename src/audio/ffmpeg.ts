export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export function escapeFfmpegConcatPath(filePath: string): string {
  if (/[\n\r\\]/.test(filePath)) {
    throw new Error(`Unsafe path for ffmpeg concat list: ${filePath}`);
  }
  return filePath.replace(/'/g, "'\\''");
}

export async function runProcess(args: string[], timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, cwd?: string): Promise<ProcessResult> {
  const proc = Bun.spawn(args, {
    stdio: ["inherit", "pipe", "pipe"],
    ...(cwd ? { cwd } : {}),
  });
  const killTimer = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { stdout, stderr, exitCode, success: exitCode === 0 };
  } finally {
    clearTimeout(killTimer);
  }
}

export async function getAudioDurationMs(filePath: string): Promise<number> {
  const args = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath];
  const { stdout, success, stderr } = await runProcess(args);
  if (!success) {
    throw new Error(`FFprobe duration check failed: ${stderr}`);
  }
  const durationSeconds = parseFloat(stdout.trim());
  if (isNaN(durationSeconds)) {
    throw new Error(`Invalid duration output from ffprobe: ${stdout}`);
  }
  return Math.round(durationSeconds * 1000);
}
