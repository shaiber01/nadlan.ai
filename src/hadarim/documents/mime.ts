/** File-type helpers shared by the browser (upload, viewer) and the Node tools. */

export function mimeTypeFor(fileName: string, given?: string | null): string {
  if (given && given !== "application/octet-stream") return given;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json" }[ext] ?? "application/octet-stream";
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}
