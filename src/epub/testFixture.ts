import { zipSync, strToU8 } from "fflate";

export interface MockEpubOptions {
  title?: string;
  author?: string;
  chapter1Content?: string;
  chapter2Content?: string;
  includeInvalidContainer?: boolean;
  emptySpine?: boolean;
  paginatedPages?: number;
  metadataStyle?: "dc" | "meta-name" | "prefixed" | "none";
}

interface MockDocument {
  id: string;
  name: string;
  title: string;
  body: string;
  inSpine: boolean;
}

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const PAGINATED_PARAGRAPH =
  "गाँव की गलियों में उस सुबह धुंध छाई हुई थी और दूर से आती हुई घंटियों की आवाज़ पूरे वातावरण को भर रही थी। " +
  "रामू अपनी झोपड़ी के दरवाज़े पर बैठा हुआ आसमान की ओर देख रहा था और मन ही मन कुछ सोच रहा था। " +
  "पिछले कई दिनों से उसके मन में एक ही बात घूम रही थी कि अब उसे क्या करना चाहिए।";

const DEFAULT_CHAPTER_ONE = `<h1>Chapter 1: The Departure</h1>
    <p>The morning sun crested the high mountain peaks, casting long golden shadows across the ancient valley. For more than twenty years, the quiet village had known nothing but peaceful days, yet today the whispering winds carried an unmistakable warning of impending change that no one could ignore.</p>
    <p>Elena checked the leather straps on her pack and tightened her boots before stepping out onto the cobblestone path. She had studied the old maps for months, tracing the forgotten routes through the northern passes where few travelers dared to venture in the depths of autumn.</p>
    <p>"You need not make this journey alone," Marcus called out from the doorway of the forge, wiping coal dust from his brow as he approached with a sturdy walking staff crafted from seasoned ironwood.</p>
    <p>"The path is long and fraught with peril," she replied with a determined smile, "but every mile brings us closer to unraveling the mystery that has haunted these borderlands for generations."</p>
    <p>Together they set forth along the winding trail, leaving the comfort of their home behind as the forest canopy closed overhead, painting the road in dappled shades of green and amber. The journey would test their courage and endurance in ways they could scarcely anticipate.</p>
    <p>As the village disappeared from view behind the rising ridges of the foothills, the landscape grew wilder and more rugged. Ancient oak trees with sprawling roots flanked the narrow track, while distant waterfalls cascaded down sheer granite cliffs, filling the valley with a persistent roar.</p>
    <p>They marched in steady rhythm through the morning hours, pausing only to drink fresh spring water and consult the worn parchment maps. Every landmark described in the ancient chronicles appeared before them in sequence, confirming that they were indeed following the true historic passage into the northern domain.</p>`;

const DEFAULT_CHAPTER_TWO = `<h1>Chapter 2: The Whispering Woods</h1>
    <p>By late afternoon the paved road had disappeared entirely beneath thick layers of moss and fallen leaves. The towering pines stood like silent sentinels on all sides, their interlocking branches filtering the sunlight into faint emerald beams that danced on the damp forest floor.</p>
    <p>"Listen closely," Elena murmured, raising a hand to pause their steady march. "The sound is not merely the breeze through the pine needles; it carries a rhythm, almost like an ancient chant echoing from the stone ruins ahead."</p>
    <p>Marcus stepped forward cautiously, his hand resting on the hilt of his short sword as he scanned the shadowed groves for any sign of movement. The air grew perceptibly cooler with every step they took toward the clearing where the moss-covered monoliths stood.</p>
    <p>As they entered the circle of ancient stones, a soft turquoise luminescence began to emanate from the carved runes, illuminating their path into the forgotten sanctuary of the elders. Legends spoke of the celestial alignments that occurred once every century, opening doorways long sealed by forgotten wards.</p>
    <p>They advanced toward the center of the ring, where a crystalline pedestal caught the ambient glow. The air hummed with dormant power, vibrating gently beneath their feet as the runes flared brighter in response to their approach.</p>
    <p>"Whatever happens next," Marcus whispered with quiet awe, "we must remain vigilant. The guardians of the sanctuary were never known to yield their secrets lightly to outsiders."</p>
    <p>Elena approached the pedestal and placed her hand upon the cool polished surface. A surge of harmonic resonance reverberated through the stones, echoing out into the quiet twilight as the first star of the evening emerged in the northern sky above the canopy.</p>`;

export function createMockEpub(options: MockEpubOptions): Buffer {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
  };

  if (!options.includeInvalidContainer) {
    files["META-INF/container.xml"] = strToU8(CONTAINER_XML);
  }

  const documents = options.paginatedPages ? paginatedDocuments(options.paginatedPages) : chapterDocuments(options);
  for (const document of documents) {
    files[`OEBPS/${document.name}`] = strToU8(htmlDocument(document));
  }
  files["OEBPS/content.opf"] = strToU8(packageDocument(buildMetadataBlock(options), documents));

  return Buffer.from(zipSync(files));
}

function chapterDocuments(options: MockEpubOptions): MockDocument[] {
  const spineItems = !options.emptySpine;
  return [
    { id: "ch1", name: "ch1.xhtml", title: "Chapter 1", body: options.chapter1Content ?? DEFAULT_CHAPTER_ONE, inSpine: spineItems },
    { id: "ch2", name: "ch2.xhtml", title: "Chapter 2", body: options.chapter2Content ?? DEFAULT_CHAPTER_TWO, inSpine: spineItems },
  ];
}

function paginatedDocuments(pageCount: number): MockDocument[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    id: `p${index}`,
    name: `page_${index + 1}.html`,
    title: "",
    body: `<p>${PAGINATED_PARAGRAPH.repeat(2)}</p>`,
    inSpine: true,
  }));
}

function htmlDocument(document: MockDocument): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${document.title}</title></head>
<body>${document.body}</body>
</html>`;
}

function packageDocument(metadataBlock: string, documents: MockDocument[]): string {
  const manifestItems = documents
    .map((document) => `    <item id="${document.id}" href="${document.name}" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItemRefs = documents
    .filter((document) => document.inSpine)
    .map((document) => `<itemref idref="${document.id}"/>`)
    .join("");

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  ${metadataBlock}
  <manifest>
${manifestItems}
  </manifest>
  <spine>
    ${spineItemRefs}
  </spine>
</package>`;
}

function buildMetadataBlock(options: MockEpubOptions): string {
  const title = options.title ?? "The Chronicles of Testing";
  const author = options.author ?? "Arthur C. Tester";

  if (options.metadataStyle === "none") {
    return `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <meta property="dcterms:modified">2024-06-28T23:05:41Z</meta>
  </metadata>`;
  }

  if (options.metadataStyle === "meta-name") {
    return `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <meta name="title" content="${title}"/>
    <meta name="creator" content="${author}"/>
    <dc:language>en</dc:language>
  </metadata>`;
  }

  if (options.metadataStyle === "prefixed") {
    return `<metadata xmlns:dcterms="http://purl.org/dc/terms/">
    <dcterms:title>${title}</dcterms:title>
    <dcterms:creator>${author}</dcterms:creator>
    <dcterms:language>en</dcterms:language>
  </metadata>`;
  }

  return `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>`;
}
