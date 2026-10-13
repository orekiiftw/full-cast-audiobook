import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { renderHookOnServer } from "./testSupport";
import { useAudioTransport, type AudioTransport } from "./useAudioTransport";

const PAGE_URL = "http://localhost/";

const HAVE_ENOUGH_DATA = 4;

class LoadResettingAudio {
  playbackRate = 1;
  defaultPlaybackRate = 1;
  readyState = HAVE_ENOUGH_DATA;
  private source = "";

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = new URL(value, PAGE_URL).href;
    this.load();
  }

  load(): void {
    this.playbackRate = this.defaultPlaybackRate;
  }

  play(): Promise<void> {
    return Promise.resolve();
  }
}

const globals = globalThis as unknown as Record<string, unknown>;

beforeAll(() => {
  globals.window = { location: { href: PAGE_URL } };
  globals.HTMLMediaElement = { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 };
});

afterAll(() => {
  delete globals.window;
  delete globals.HTMLMediaElement;
});

function renderTransport(audio: LoadResettingAudio): AudioTransport {
  const session = {
    audioRef: { current: audio as unknown as HTMLAudioElement },
    wantsPlaybackRef: { current: false },
    playGenerationRef: { current: 0 },
    notifyPlayBlocked: () => {},
  };
  return renderHookOnServer(() => useAudioTransport(session));
}

describe("useAudioTransport playback speed", () => {
  it("keeps the chosen speed when the next line's source loads", async () => {
    const audio = new LoadResettingAudio();
    const transport = renderTransport(audio);

    expect(await transport.loadAndPlay("/api/audio?key=line-1&v=4000")).toBe(true);
    transport.setPlaybackRate(1.5);
    expect(audio.playbackRate).toBe(1.5);

    expect(await transport.loadAndPlay("/api/audio?key=line-2&v=5000")).toBe(true);
    expect(audio.src).toBe(`${PAGE_URL}api/audio?key=line-2&v=5000`);
    expect(audio.playbackRate).toBe(1.5);
  });
});
