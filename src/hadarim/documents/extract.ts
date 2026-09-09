/**
 * Text extraction for real documents (Node only — the tools and the CLI; the browser never processes documents).
 * A convenience next to the agent reading the file itself: PDFs are extracted with pdf.js (Hebrew PDFs often come
 * out reordered, which is why get_document also hands the agent the local file to read), text-like files are decoded,
 * images yield no text.
 */

import { isPdf } from "./mime";

export { isImage, mimeTypeFor } from "./mime";

export type ExtractResult = { text: string | null; pages: number | null; method: "pdfjs" | "text" | "none" };

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

/** Extract what text the file carries. Never throws for an unreadable file: returns `none`. */
export async function extractText(bytes: Uint8Array, mimeType: string): Promise<ExtractResult> {
  if (isPdf(mimeType)) return extractPdf(bytes);
  if (TEXT_TYPES.has(mimeType)) return { text: new TextDecoder("utf-8").decode(bytes).trim() || null, pages: null, method: "text" };
  return { text: null, pages: null, method: "none" };
}

/** pdf.js's bundled standard fonts (silences its warning; extraction works without them). */
async function standardFonts(): Promise<string | null> {
  try {
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const pdfFile = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
    return join(dirname(pdfFile), "..", "..", "standard_fonts") + "/";
  } catch {
    return null;
  }
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const standardFontDataUrl = await standardFonts();
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), ...(standardFontDataUrl ? { standardFontDataUrl } : {}) });
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trim());
          line = "";
        }
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.filter(Boolean).join("\n"));
    }
    const text = pages.map((p, i) => (pages.length > 1 ? `--- עמוד ${i + 1} ---\n${p}` : p)).join("\n").trim();
    const numPages = doc.numPages;
    await task.destroy();
    return { text: text || null, pages: numPages, method: "pdfjs" };
  } catch {
    return { text: null, pages: null, method: "none" };
  }
}
