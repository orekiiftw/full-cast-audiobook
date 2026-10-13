import { afterAll, describe, expect, it, mock } from "bun:test";
import * as gemini from "./gemini";
import { NEUTRAL_BEAT_DELIVERY, annotateSegment } from "./index";

let modelResponse = "";

const realGemini = { ...gemini };
mock.module("./gemini", () => ({ requestAnnotation: async () => modelResponse }));
afterAll(() => {
  mock.module("./gemini", () => realGemini);
});

function respondWith(...texts: string[]): void {
  modelResponse = JSON.stringify({
    scene_summary: "A quiet exit.",
    beats: texts.map((text) => ({ text, delivery: { style: "hushed", emotion: "wistful", intensity: 0.6, pace: "slow" } })),
  });
}

describe("annotateSegment alignment fallback", () => {
  it("narrates the original Hindi text when the model rewrites it", async () => {
    respondWith("श्याम बाज़ार गया।");

    const result = await annotateSegment("राम घर गया।", [], "A scene in the book.");

    expect(result.beats).toEqual([{ text: "राम घर गया।", delivery: { ...NEUTRAL_BEAT_DELIVERY } }]);
  });

  it("keeps the model's beats when they reproduce a Chinese segment", async () => {
    respondWith("他走到门口。", "然后离开了。");

    const result = await annotateSegment("他走到门口。然后离开了。", [], "A scene in the book.");

    expect(result.beats.map((beat) => beat.text)).toEqual(["他走到门口。", "然后离开了。"]);
    expect(result.beats[0].delivery.style).toBe("hushed");
  });
});
