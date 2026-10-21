import "server-only";

import { PDFParse } from "pdf-parse";
import { getData } from "pdf-parse/worker";

PDFParse.setWorker(getData());

const MAX_EXTRACTED_CHARACTERS = 500_000;

export async function extractDocumentText(
  bytes: Uint8Array,
  mimeType: "application/pdf" | "text/csv" | "text/plain",
) {
  let text: string;

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: bytes });

    try {
      const result = await parser.getText();
      text = result.text.trim();
    } catch (error) {
      throw new DocumentExtractionError(
        error instanceof Error
          ? `PDF text extraction failed: ${error.message}`
          : "PDF text extraction failed.",
      );
    } finally {
      await parser.destroy();
    }
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    } catch {
      throw new DocumentExtractionError("Text evidence must use UTF-8 encoding.");
    }
  }

  if (!text) {
    throw new DocumentExtractionError(
      mimeType === "application/pdf"
        ? "The PDF has no extractable text."
        : "Text evidence cannot be empty.",
    );
  }

  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new DocumentExtractionError(
      "Extracted document text cannot exceed 500,000 characters.",
    );
  }

  return text;
}

export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}
