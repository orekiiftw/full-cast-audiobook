import { describe, expect, it } from "bun:test";
import { createNeutralBeat } from "./beats";
import { beatsMatchSegment, parseAnnotationResponse } from "./response";

const beats = (...texts: string[]) => texts.map((text) => createNeutralBeat(text));

describe("beatsMatchSegment", () => {
  it("accepts beats that reproduce a Chinese, Hindi or Russian segment", () => {
    expect(beatsMatchSegment(beats("他走到门口。", "然后离开了。"), "他走到门口。然后离开了。")).toBe(true);
    expect(beatsMatchSegment(beats("राम घर गया।", "तब वह चला।"), "राम घर गया। तब वह चला।")).toBe(true);
    expect(beatsMatchSegment(beats("Он подошёл к двери.", "И ушёл."), "Он подошёл к двери. И ушёл.")).toBe(true);
  });

  it("rejects beats that rewrite a Chinese, Hindi or Russian segment", () => {
    expect(beatsMatchSegment(beats("她跑到窗前。"), "他走到门口。")).toBe(false);
    expect(beatsMatchSegment(beats("श्याम बाज़ार गया।"), "राम घर गया।")).toBe(false);
    expect(beatsMatchSegment(beats("Она ушла."), "Он подошёл к двери.")).toBe(false);
  });

  it("rejects beats that drop or add a sentence in a non-Latin segment", () => {
    expect(beatsMatchSegment(beats("他走到门口。"), "他走到门口。然后离开了。")).toBe(false);
    expect(beatsMatchSegment(beats("Он подошёл к двери.", "И ушёл.", "Навсегда."), "Он подошёл к двери. И ушёл.")).toBe(false);
  });

  it("rejects a Hindi beat that only changes a vowel sign", () => {
    expect(beatsMatchSegment(beats("दाल"), "दिल")).toBe(false);
  });

  it("keeps tolerating case, spacing, quote and punctuation differences", () => {
    expect(beatsMatchSegment(beats("“Hello,” she said.", "  Then   she LEFT!"), '"Hello," she said. Then she left.')).toBe(true);
    expect(beatsMatchSegment(beats("«Привет», — сказала она."), '"Привет" - сказала она')).toBe(true);
    expect(beatsMatchSegment(beats("他说：“你好。”"), "他说「你好」")).toBe(true);
  });

  it("treats composed and decomposed accents, and full-width digits, as the same text", () => {
    expect(beatsMatchSegment(beats("Caf\u00e9 ２４"), "Cafe\u0301 24")).toBe(true);
    expect(beatsMatchSegment(beats("Cafe 24"), "Caf\u00e9 24")).toBe(false);
  });

  it("does not vouch for beats when the segment has no letters or digits to compare", () => {
    expect(beatsMatchSegment(beats("……"), "……")).toBe(false);
    expect(beatsMatchSegment(beats(""), "")).toBe(false);
  });

  it("rejects a non-Latin beat that the beat length cap cut short", () => {
    const segment = "他走到门口，然后离开了。".repeat(400);
    const parsed = parseAnnotationResponse(JSON.stringify({ scene_summary: "s", beats: [{ text: segment }] }), segment, "s");

    expect(parsed.beats[0].text.length).toBeLessThan(segment.length);
    expect(beatsMatchSegment(parsed.beats, segment)).toBe(false);
  });
});
