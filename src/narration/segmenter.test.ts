import { describe, expect, it } from "bun:test";
import { segmentChapter } from "./segmenter";
import { BookBlock, countWords } from "../epub";
import { SEGMENT } from "../lib/constants";

const CHINESE_PARAGRAPH =
  "清晨的薄雾笼罩着整个村庄，远处传来的钟声在山谷之间回荡，仿佛在提醒人们新的一天已经开始。老李坐在自家门前的石阶上，望着远方的群山发呆，心里一直在想着昨天夜里发生的那件怪事。";

const THAI_PARAGRAPH =
  "หมอกยามเช้าปกคลุมหมู่บ้านทั้งหมด เสียงระฆังที่ดังมาจากที่ไกลสะท้อนไปมาระหว่างหุบเขา ชายชราคนนั้นนั่งอยู่บนบันไดหินหน้าบ้านของตัวเอง มองดูภูเขาที่อยู่ไกลออกไปอย่างเหม่อลอย";

describe("segmentChapter", () => {
  it("chunks standard narration blocks into segments", () => {
    const blocks: BookBlock[] = [
      {
        type: "narration",
        text: "The morning light filtered through the dense branches of the ancient forest, illuminating the mossy path below.",
      },
      {
        type: "narration",
        text: "Elena paused at the crossing, checking her compass and adjusting the worn leather strap of her traveling pack.",
      },
      {
        type: "narration",
        text: "Every step brought them closer to the borderlands where the ruins were rumored to lie hidden beneath the mist.",
      },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[0].text).toContain("The morning light");
    expect(segments[0].isSceneBreak).toBe(false);
  });

  it("isolates headings so they do not exhaust the prose lead-in budget", () => {
    const blocks: BookBlock[] = [
      { type: "heading", text: "Chapter 1: The Beginning" },
      {
        type: "narration",
        text: "This is the first sentence of the real story that follows the chapter heading.",
      },
      {
        type: "narration",
        text: "The journey begins here with steady determination as the characters advance.",
      },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0].text).toBe("Chapter 1: The Beginning");
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[1].text).toContain("This is the first sentence");
    expect(segments[1].segmentIndex).toBe(2);
  });

  it("detects explicit scene breaks and marks isSceneBreak correctly", () => {
    const blocks: BookBlock[] = [
      { type: "narration", text: "The conversation ended on a grim note as darkness settled over the camp." },
      { type: "narration", text: "* * *" },
      { type: "narration", text: "The next morning brought clearer skies and renewed hope for the travelers." },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(2);
    expect(segments[0].isSceneBreak).toBe(true);
    expect(segments[1].text).toContain("The next morning");
    expect(segments[1].isSceneBreak).toBe(false);
  });

  it("respects sentence boundaries and does not split on common abbreviations", () => {
    const text = "Dr. Watson met Mr. Holmes at 221B Baker St. in London. They discussed the mysterious case with Prof. Moriarty.";
    const blocks: BookBlock[] = [{ type: "narration", text }];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(1);
    expect(segments[0].text).toContain("Dr. Watson met Mr. Holmes");
    expect(segments[0].text).toContain("Prof. Moriarty.");
  });

  it("hard-splits oversized text exceeding HARD_MAX_WORDS", () => {
    const oversizedSentence = Array.from({ length: 650 }, (_, i) => `word${i}`).join(" ");
    const blocks: BookBlock[] = [{ type: "narration", text: oversizedSentence }];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of segments) {
      const wordCount = seg.text.trim().split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeLessThanOrEqual(SEGMENT.HARD_MAX_WORDS + 10);
    }
  });

  it("groups short dialogue with attribution", () => {
    const blocks: BookBlock[] = [
      { type: "dialogue", text: '"Are you ready?" she asked softly.' },
      { type: "narration", text: "Marcus nodded without saying another word." },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(1);
    expect(segments[0].text).toContain('"Are you ready?" she asked softly.');
    expect(segments[0].text).toContain("Marcus nodded");
  });

  it("never breaks a segment where a page-broken paragraph left a sentence unfinished", () => {
    const firstHalf = Array.from({ length: SEGMENT.MAX_WORDS - 5 }, (_, i) => `word${i}`)
      .join(" ")
      .concat(" and then, without warning,");
    const secondHalf = "the lantern guttered out and left them standing in complete darkness.";
    const nextSentence = "They waited in silence until their eyes adjusted to the faint moonlight.";
    const blocks: BookBlock[] = [
      { type: "narration", text: firstHalf },
      { type: "narration", text: secondHalf },
      { type: "narration", text: nextSentence },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(2);
    expect(segments[0].text).toContain("and then, without warning, the lantern guttered out");
    for (const segment of segments) {
      expect(/[.!?।॥…”"')]$/.test(segment.text.trim())).toBe(true);
    }
  });

  it("splits Devanagari sentences on the danda", () => {
    const blocks: BookBlock[] = [
      {
        type: "narration",
        text: "गाँव की गलियों में उस सुबह धुंध छाई हुई थी और दूर से आती हुई घंटियों की आवाज़ पूरे वातावरण को भर रही थी। रामू अपनी झोपड़ी के दरवाज़े पर बैठा हुआ आसमान की ओर देख रहा था। पिछले कई दिनों से उसके मन में एक ही बात घूम रही थी कि अब उसे क्या करना चाहिए।",
      },
    ];
    const filler = Array.from({ length: SEGMENT.TARGET_WORDS }, (_, i) => `शब्द${i}`)
      .join(" ")
      .concat("।");

    const segments = segmentChapter([...blocks, { type: "narration", text: filler }]);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(/[.!?।॥]$/.test(segment.text.trim())).toBe(true);
    }
  });

  it("keeps Chinese and Thai prose written without spaces between words under HARD_MAX_WORDS", () => {
    for (const paragraph of [CHINESE_PARAGRAPH, THAI_PARAGRAPH]) {
      const blocks: BookBlock[] = Array.from({ length: 30 }, () => ({ type: "narration", text: paragraph }));

      const segments = segmentChapter(blocks);
      expect(segments.length).toBeGreaterThan(1);
      for (const segment of segments) {
        expect(countWords(segment.text)).toBeLessThanOrEqual(SEGMENT.HARD_MAX_WORDS);
      }
      expect(segments.map((segment) => segment.text).join(" ")).toBe(blocks.map((block) => block.text).join(" "));
    }
  });

  it("caps a run of blocks that never reaches a sentence end at HARD_MAX_WORDS", () => {
    const line = "the river runs beneath the hill and carries all our sorrows home";
    const blocks: BookBlock[] = Array.from({ length: 60 }, () => ({ type: "narration", text: line }));

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.text.split(/\s+/).length).toBeLessThanOrEqual(SEGMENT.HARD_MAX_WORDS);
    }
  });
});
