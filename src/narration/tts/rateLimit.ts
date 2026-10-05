import { PIPELINE } from "../../lib/constants";
import { sleep } from "../../lib/async";

const TTS_MAX_CONCURRENCY = Math.max(1, Number(process.env.TTS_MAX_CONCURRENCY) || PIPELINE.MAX_WORKERS_PER_BOOK);

let activeCalls = 0;

const waitingCallers: Array<() => void> = [];

let coolDownUntilMs = 0;

export async function runWithTtsSlot<T>(request: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await request();
  } finally {
    releaseSlot();
  }
}

export async function waitForRateLimitGate(): Promise<void> {
  const waitMs = coolDownUntilMs - Date.now();
  if (waitMs <= 0) return;
  console.log(`⏳ TTS cool-down ${Math.ceil(waitMs / 1000)}s (shared rate-limit gate)…`);
  await sleep(waitMs);
}

export function extendRateLimitCoolDown(coolDownMs: number): void {
  coolDownUntilMs = Math.max(coolDownUntilMs, Date.now() + coolDownMs);
}

function acquireSlot(): Promise<void> {
  if (activeCalls < TTS_MAX_CONCURRENCY) {
    activeCalls += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitingCallers.push(() => {
      activeCalls += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCalls = Math.max(0, activeCalls - 1);
  const next = waitingCallers.shift();
  if (next) next();
}
