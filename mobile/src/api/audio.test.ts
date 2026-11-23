import { audioKeyFromUrl, audioKeysOf, chunkKeys, signedUrlFor } from "./audio";
import { segment } from "@/playback/testFixtures";

describe("media token key extraction", () => {
  it("reads the key out of a stream path and decodes it", () => {
    expect(audioKeyFromUrl("/api/audio?key=book%2Fch%2F1.wav&v=1200")).toBe("book/ch/1.wav");
    expect(audioKeyFromUrl("/api/audio?key=plain/key.wav")).toBe("plain/key.wav");
    expect(audioKeyFromUrl("https://api.test/api/audio?key=abc&exp=1&sig=deadbeef")).toBe("abc");
  });

  it("returns null for anything that is not an audio stream url", () => {
    expect(audioKeyFromUrl(null)).toBeNull();
    expect(audioKeyFromUrl(undefined)).toBeNull();
    expect(audioKeyFromUrl("/api/audio")).toBeNull();
    expect(audioKeyFromUrl("/api/books/1/cover.png?key=x")).toBeNull();
    expect(audioKeyFromUrl("/api/audio?v=12")).toBeNull();
    expect(audioKeyFromUrl("https://cdn.test/audio/1.wav")).toBeNull();
  });

  it("collects unique keys in playback order", () => {
    const lines = [
      segment({ segmentIndex: 1, audioUrl: "/api/audio?key=a.wav" }),
      segment({ segmentIndex: 2, audioUrl: "/api/audio?key=b.wav" }),
      segment({ segmentIndex: 3, audioUrl: "/api/audio?key=a.wav" }),
      segment({ segmentIndex: 4, status: "queued", audioUrl: null }),
    ];

    expect(audioKeysOf(lines)).toEqual(["a.wav", "b.wav"]);
  });

  it("batches under the route's 50-key cap", () => {
    const keys = Array.from({ length: 128 }, (_, index) => `k${index}.wav`);
    const batches = chunkKeys(keys);

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 28]);
    expect(batches.flat()).toEqual(keys);
  });

  it("resolves a signed url per key and refuses an unsigned line", () => {
    const line = segment({ segmentIndex: 1, audioUrl: "/api/audio?key=a.wav&v=1000" });

    expect(signedUrlFor(line, { "a.wav": "https://signed/a.wav?sig=1" })).toBe("https://signed/a.wav?sig=1");
    expect(signedUrlFor(line, {})).toBeNull();
    expect(signedUrlFor(segment({ segmentIndex: 2, audioUrl: null }), {})).toBeNull();
  });

  it("absolutizes a signed server path against the API base", () => {
    const line = segment({ segmentIndex: 1, audioUrl: "/api/audio?key=a.wav&v=1000" });

    expect(signedUrlFor(line, { "a.wav": "/api/audio?key=a.wav&exp=1&sig=2" })).toBe(
      "http://localhost:3000/api/audio?key=a.wav&exp=1&sig=2",
    );
  });

  it("passes an already-absolute source through unsigned", () => {
    const external = segment({ segmentIndex: 1, audioUrl: "https://cdn.test/line.mp3" });

    expect(signedUrlFor(external, {})).toBe("https://cdn.test/line.mp3");
  });
});
