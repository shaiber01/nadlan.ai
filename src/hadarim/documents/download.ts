import type { HDocument } from "../data/types";
import { documentFileUrl } from "../db/client";

/** A seed page as plain text: its blocks in reading order, tables as tab-separated rows. */
export function documentAsText(doc: HDocument): string {
  const lines: string[] = [doc.titleHe, ""];
  for (const b of doc.blocks) {
    if (b.kind === "table") {
      for (const row of b.rows ?? []) lines.push(row.join("\t"));
      lines.push("");
    } else if (b.text) {
      lines.push(b.text);
      lines.push("");
    }
  }
  if (doc.footerHe) lines.push(doc.footerHe);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** What a download hands over: the stored file by its public URL, or a seed page rendered as a text file. */
export function documentDownload(doc: HDocument): { fileName: string; url?: string; text?: string } {
  if (doc.filePath) return { fileName: doc.fileName, url: documentFileUrl(doc.filePath) };
  return { fileName: `${doc.fileName.replace(/\.[^.]+$/, "")}.txt`, text: documentAsText(doc) };
}

/** Save the document through the browser (a stored file is fetched as a blob so its name survives the cross-origin download). */
export async function downloadDocument(doc: HDocument): Promise<void> {
  const d = documentDownload(doc);
  const blob = d.url ? await (await fetch(d.url)).blob() : new Blob([d.text ?? ""], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = d.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
