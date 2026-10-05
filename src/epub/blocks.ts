import { parse, type HTMLElement } from "node-html-parser";
import { cleanText, countWords, isDialogue } from "./text";

export interface BookBlock {
  type: "heading" | "narration" | "dialogue" | "footnote" | "poem" | "letter";
  text: string;
}

const BARE_BOOK_TITLE_MAX_LENGTH = 60;

const DETECTED_HEADING_MAX_LENGTH = 120;

const BARE_PAGE_NUMBER_RE = /^\d{1,4}$/;

const DECORATED_PAGE_NUMBER_RE = /^[.…·•\-\s]*\d{1,4}\s*$/;

export function readPageBody(htmlContent: string): HTMLElement | null {
  const document = parse(htmlContent);

  document.querySelectorAll("script, style, img, svg").forEach((element) => element.remove());
  document.querySelectorAll("[epub\\:type='pagebreak'], .pagebreak, .page").forEach((element) => element.remove());
  document.querySelectorAll("sup").forEach((sup) => {
    if (sup.querySelector("a")) {
      sup.remove();
    }
  });

  return document.querySelector("body");
}

export function detectHeading(body: HTMLElement, bookTitle: string): string {
  const isBareTitle = (text: string) => text.toLowerCase() === bookTitle.toLowerCase();

  for (const heading of body.querySelectorAll("h1, h2, h3")) {
    const text = heading.text.trim();
    if (text && !isBareTitle(text)) return text;
  }

  for (const element of body.querySelectorAll("p, div, span")) {
    const className = element.getAttribute("class") || "";
    if (/title|head/i.test(className)) {
      const text = element.text.trim();
      if (text && text.length < DETECTED_HEADING_MAX_LENGTH && !isBareTitle(text)) return text;
    }
  }

  return "";
}

export function readPageBlocks(body: HTMLElement, bookTitle: string): BookBlock[] {
  const blocks: BookBlock[] = [];

  for (const paragraph of body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote")) {
    const text = cleanText(paragraph.text);
    if (!text) continue;
    if (text.length < BARE_BOOK_TITLE_MAX_LENGTH && text.toLowerCase() === bookTitle.toLowerCase()) continue;
    if (BARE_PAGE_NUMBER_RE.test(text) || DECORATED_PAGE_NUMBER_RE.test(text)) continue;

    blocks.push({ type: classifyBlock(paragraph, text), text });
  }

  return blocks;
}

export function countBlockWords(blocks: BookBlock[]): number {
  return blocks.reduce((total, block) => total + countWords(block.text), 0);
}

function classifyBlock(element: HTMLElement, text: string): BookBlock["type"] {
  const tagName = element.tagName.toLowerCase();
  const className = element.getAttribute("class") ?? "";

  if (/^h[1-6]$/.test(tagName)) return "heading";
  if (className.includes("footnote") || element.getAttribute("epub:type")?.includes("footnote")) return "footnote";
  if (tagName === "blockquote" || className.includes("poem")) return "poem";
  if (className.includes("letter") || className.includes("epistle")) return "letter";
  if (isDialogue(text)) return "dialogue";
  return "narration";
}
