import { describe, expect, it } from "bun:test";
import { parseEpub } from "./epubService";
import { zipSync, strToU8 } from "fflate";

function createMockEpub(options: {
  title?: string;
  author?: string;
  chapter1Content?: string;
  chapter2Content?: string;
  includeInvalidContainer?: boolean;
  emptySpine?: boolean;
}): Buffer {
  const title = options.title ?? "The Chronicles of Testing";
  const author = options.author ?? "Arthur C. Tester";
  const ch1 =
    options.chapter1Content ??
    `<h1>Chapter 1: The Departure</h1>
    <p>The morning sun crested the high mountain peaks, casting long golden shadows across the ancient valley. For more than twenty years, the quiet village had known nothing but peaceful days, yet today the whispering winds carried an unmistakable warning of impending change that no one could ignore.</p>
    <p>Elena checked the leather straps on her pack and tightened her boots before stepping out onto the cobblestone path. She had studied the old maps for months, tracing the forgotten routes through the northern passes where few travelers dared to venture in the depths of autumn.</p>
    <p>"You need not make this journey alone," Marcus called out from the doorway of the forge, wiping coal dust from his brow as he approached with a sturdy walking staff crafted from seasoned ironwood.</p>
    <p>"The path is long and fraught with peril," she replied with a determined smile, "but every mile brings us closer to unraveling the mystery that has haunted these borderlands for generations."</p>
    <p>Together they set forth along the winding trail, leaving the comfort of their home behind as the forest canopy closed overhead, painting the road in dappled shades of green and amber. The journey would test their courage and endurance in ways they could scarcely anticipate.</p>
    <p>As the village disappeared from view behind the rising ridges of the foothills, the landscape grew wilder and more rugged. Ancient oak trees with sprawling roots flanked the narrow track, while distant waterfalls cascaded down sheer granite cliffs, filling the valley with a persistent roar.</p>
    <p>They marched in steady rhythm through the morning hours, pausing only to drink fresh spring water and consult the worn parchment maps. Every landmark described in the ancient chronicles appeared before them in sequence, confirming that they were indeed following the true historic passage into the northern domain.</p>`;

  const ch2 =
    options.chapter2Content ??
    `<h1>Chapter 2: The Whispering Woods</h1>
    <p>By late afternoon the paved road had disappeared entirely beneath thick layers of moss and fallen leaves. The towering pines stood like silent sentinels on all sides, their interlocking branches filtering the sunlight into faint emerald beams that danced on the damp forest floor.</p>
    <p>"Listen closely," Elena murmured, raising a hand to pause their steady march. "The sound is not merely the breeze through the pine needles; it carries a rhythm, almost like an ancient chant echoing from the stone ruins ahead."</p>
    <p>Marcus stepped forward cautiously, his hand resting on the hilt of his short sword as he scanned the shadowed groves for any sign of movement. The air grew perceptibly cooler with every step they took toward the clearing where the moss-covered monoliths stood.</p>
    <p>As they entered the circle of ancient stones, a soft turquoise luminescence began to emanate from the carved runes, illuminating their path into the forgotten sanctuary of the elders. Legends spoke of the celestial alignments that occurred once every century, opening doorways long sealed by forgotten wards.</p>
    <p>They advanced toward the center of the ring, where a crystalline pedestal caught the ambient glow. The air hummed with dormant power, vibrating gently beneath their feet as the runes flared brighter in response to their approach.</p>
    <p>"Whatever happens next," Marcus whispered with quiet awe, "we must remain vigilant. The guardians of the sanctuary were never known to yield their secrets lightly to outsiders."</p>
    <p>Elena approached the pedestal and placed her hand upon the cool polished surface. A surge of harmonic resonance reverberated through the stones, echoing out into the quiet twilight as the first star of the evening emerged in the northern sky above the canopy.</p>`;
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
  };

  if (!options.includeInvalidContainer) {
    files["META-INF/container.xml"] = strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  }

  files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    ${options.emptySpine ? "" : '<itemref idref="ch1"/><itemref idref="ch2"/>'}
  </spine>
</package>`);

  files["OEBPS/ch1.xhtml"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>${ch1}</body>
</html>`);

  files["OEBPS/ch2.xhtml"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>${ch2}</body>
</html>`);

  return Buffer.from(zipSync(files));
}

describe("parseEpub", () => {
  it("rejects non-ZIP buffers", () => {
    const invalidBuffer = Buffer.from("this is definitely not a zip file");
    expect(() => parseEpub(invalidBuffer)).toThrow("not a valid ZIP archive");
  });

  it("rejects EPUB with missing container.xml", () => {
    const epubWithoutContainer = createMockEpub({ includeInvalidContainer: true });
    expect(() => parseEpub(epubWithoutContainer)).toThrow("Missing META-INF/container.xml");
  });

  it("rejects EPUB with empty spine", () => {
    const epubWithEmptySpine = createMockEpub({ emptySpine: true });
    expect(() => parseEpub(epubWithEmptySpine)).toThrow("Spine is empty");
  });

  it("parses valid EPUB metadata, chapters, and content blocks correctly", () => {
    const validEpub = createMockEpub({
      title: "The Silver Citadel",
      author: "Gwenevere Vance",
    });

    const parsed = parseEpub(validEpub);
    expect(parsed.title).toBe("The Silver Citadel");
    expect(parsed.author).toBe("Gwenevere Vance");
    expect(parsed.chapters.length).toBe(2);

    expect(parsed.chapters[0].chapterIndex).toBe(1);
    expect(parsed.chapters[0].title).toBe("Chapter 1: The Departure");
    expect(parsed.chapters[0].blocks.length).toBeGreaterThan(0);

    expect(parsed.chapters[1].chapterIndex).toBe(2);
    expect(parsed.chapters[1].title).toBe("Chapter 2: The Whispering Woods");
  });

  it("rejects EPUB with too few words under MIN_BOOK_WORDS threshold", () => {
    const shortEpub = createMockEpub({
      chapter1Content: "<h1>Chapter 1</h1><p>Too short.</p>",
      chapter2Content: "<h1>Chapter 2</h1><p>Also way too short.</p>",
    });

    expect(() => parseEpub(shortEpub)).toThrow("The book content is too short");
  });
});
