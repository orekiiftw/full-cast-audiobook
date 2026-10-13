import { describe, expect, it } from "bun:test";
import { countWords, splitByWordCount } from "./text";

describe("countWords", () => {
  it("counts whitespace-separated words in spaced scripts", () => {
    expect(countWords("  The lantern guttered out.  ")).toBe(4);
    expect(countWords("रामू अपनी झोपड़ी के दरवाज़े पर बैठा था।")).toBe(8);
    expect(countWords(" \n ")).toBe(0);
  });

  it("counts words in scripts written without spaces between words", () => {
    expect(countWords("清晨的薄雾笼罩着整个村庄，远处传来的钟声在山谷之间回荡。")).toBeGreaterThan(10);
    expect(countWords("朝の霧が村全体を包み込み、遠くから聞こえる鐘の音が谷間に響いていた。")).toBeGreaterThan(10);
    expect(countWords("หมอกยามเช้าปกคลุมหมู่บ้านทั้งหมด")).toBeGreaterThan(3);
  });
});

describe("splitByWordCount", () => {
  it("splits spaced text every maxWords words", () => {
    expect(splitByWordCount("one two three four five", 2)).toEqual(["one two", "three four", "five"]);
    expect(splitByWordCount("  one two  ", 5)).toEqual(["one two"]);
  });

  it("splits unspaced text on word boundaries without dropping characters", () => {
    const text = "清晨的薄雾笼罩着整个村庄，远处传来的钟声在山谷之间回荡，仿佛在提醒人们新的一天已经开始。";

    const chunks = splitByWordCount(text, 5);
    expect(chunks.length).toBe(Math.ceil(countWords(text) / 5));
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(countWords(chunk)).toBeLessThanOrEqual(5);
    }
  });
});
