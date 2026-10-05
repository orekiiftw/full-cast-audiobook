import * as path from "path";
import { parse, type HTMLElement } from "node-html-parser";
import { findArchiveEntry, readArchiveEntryText, type ArchiveEntries } from "./archive";
import { EPUB_LIMITS } from "../lib/constants";

const CONTAINER_PATH = "META-INF/container.xml";

const UNKNOWN_TITLE = "Unknown Title";

const UNKNOWN_AUTHOR = "Unknown Author";

export function resolvePackagePath(entries: ArchiveEntries): string {
  if (!findArchiveEntry(entries, CONTAINER_PATH)) {
    throw new Error("Invalid EPUB: Missing META-INF/container.xml");
  }

  const containerContent = readArchiveEntryText(entries, CONTAINER_PATH, EPUB_LIMITS.MAX_CONTAINER_BYTES, "container.xml");
  const rootfileTag = containerContent.match(/<rootfile\b[^>]*>/i)?.[0] ?? "";
  const rootfilePath = rootfileTag.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!rootfilePath) {
    throw new Error("Invalid container.xml: Cannot find rootfile path");
  }

  const rawPackagePath = rootfilePath.replace(/\\/g, "/").split("#")[0].split("?")[0];
  if (rawPackagePath.includes("..") || path.isAbsolute(rawPackagePath) || rawPackagePath.startsWith("/")) {
    throw new Error("Invalid container.xml: OPF path contains traversal or absolute components");
  }

  const packagePath = path.posix.normalize(rawPackagePath);
  if (packagePath.includes("..")) {
    throw new Error("Invalid container.xml: OPF path resolves outside archive");
  }
  if (!findArchiveEntry(entries, packagePath)) {
    throw new Error(`Missing OPF file at path: ${packagePath}`);
  }

  return packagePath;
}

interface PackageDocument {
  content: string;
  document: HTMLElement;
  directory: string;
}

export function readPackageDocument(entries: ArchiveEntries, packagePath: string): PackageDocument {
  const content = readArchiveEntryText(entries, packagePath, EPUB_LIMITS.MAX_OPF_BYTES, "package document");
  return { content, document: parse(content), directory: path.dirname(packagePath) };
}

interface BookMetadata {
  title: string;
  author: string;
}

export function readBookMetadata(packageContent: string, packageDocument: HTMLElement): BookMetadata {
  return {
    title: extractOpfMetadata(packageContent, packageDocument, "title") ?? UNKNOWN_TITLE,
    author: extractOpfMetadata(packageContent, packageDocument, "creator") ?? UNKNOWN_AUTHOR,
  };
}

export function resolveReadingOrder(packageDocument: HTMLElement, packageDirectory: string): string[] {
  const manifestPaths = buildManifestPaths(packageDocument, packageDirectory);
  const readingOrder: string[] = [];

  for (const itemref of packageDocument.querySelectorAll("spine itemref")) {
    const idref = itemref.getAttribute("idref");
    if (!idref) continue;
    if ((itemref.getAttribute("linear") ?? "yes").toLowerCase() === "no") continue;

    const filePath = manifestPaths.get(idref);
    if (filePath) readingOrder.push(filePath);
  }

  if (readingOrder.length === 0) {
    throw new Error("Invalid EPUB: Spine is empty or could not be mapped to files.");
  }

  return readingOrder;
}

function extractOpfMetadata(packageContent: string, packageDocument: HTMLElement, field: "title" | "creator"): string | undefined {
  const decode = (value: string) =>
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  const clean = (value: string | undefined) => {
    const decoded = value ? decode(value) : "";
    return decoded && decoded.toLowerCase() !== "unknown" ? decoded : undefined;
  };

  const elementPattern = new RegExp(`<([a-zA-Z0-9_-]+:)?${field}\\b[^>]*>([\\s\\S]*?)</([a-zA-Z0-9_-]+:)?${field}>`, "i");
  const elementValue = clean(packageContent.match(elementPattern)?.[2]);
  if (elementValue) return elementValue;

  for (const name of field === "title" ? ["title"] : ["creator", "author"]) {
    const tagPattern = new RegExp(`<meta[^>]*\\b(?:name|property)\\s*=\\s*["'][^"']*${name}["'][^>]*>`, "i");
    const tag = packageContent.match(tagPattern)?.[0];
    if (tag) {
      const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
      const inline = tag.match(/>([^<]+)</)?.[1];
      const value = clean(content ?? inline);
      if (value) return value;
    }
  }

  const node = packageDocument.querySelector(`dc\\:${field}`) ?? packageDocument.querySelector(field);
  return clean(node?.text);
}

function buildManifestPaths(packageDocument: HTMLElement, packageDirectory: string): Map<string, string> {
  const manifestPaths = new Map<string, string>();

  for (const item of packageDocument.querySelectorAll("manifest item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;

    const cleanedHref = safeDecodeHref(href).split("#")[0].split("?")[0].replace(/\\/g, "/");
    const resolvedPath = path.posix.normalize(path.posix.join(packageDirectory, cleanedHref));
    if (resolvedPath.includes("..") || path.isAbsolute(resolvedPath)) continue;

    manifestPaths.set(id, resolvedPath);
  }

  return manifestPaths;
}

function safeDecodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}
