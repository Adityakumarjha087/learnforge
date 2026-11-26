import { extractText, getDocumentProxy } from "unpdf";
import { badRequest } from "../lib/errors";

export const SUPPORTED_MIME = ["application/pdf", "text/plain", "text/markdown", "text/x-markdown"] as const;

/** Extract plain text from an uploaded PDF or notes file. */
export async function extractUploadText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const isPdf = mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  const isText = mimeType.startsWith("text/") || /\.(md|markdown|txt)$/i.test(filename);
  let text: string;
  if (isPdf) {
    if (buffer.subarray(0, 5).toString() !== "%PDF-") throw badRequest("File is not a valid PDF");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } else if (isText) {
    text = buffer.toString("utf8");
  } else {
    throw badRequest(`Unsupported file type ${mimeType}. Upload a PDF, .md or .txt file.`);
  }
  text = text.replaceAll(String.fromCharCode(0), "").trim();
  if (text.length < 200) throw badRequest("Not enough extractable text in the upload (need at least 200 characters).");
  return text.slice(0, 200_000);
}
