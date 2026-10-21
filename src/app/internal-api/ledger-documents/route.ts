import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DocumentExtractionError,
  extractDocumentText,
} from "@/lib/documents/extract-document-text";
import { supabaseServerRequest } from "@/lib/supabase/server";
import {
  downloadSupabaseStorageObject,
  uploadSupabaseStorageObject,
} from "@/lib/supabase/storage-server";

type LedgerDocument = {
  description: string | null;
  document_type: DocumentType;
  extraction_error: string | null;
  extraction_status: "pending" | "extracting" | "ready" | "failed";
  file_name: string;
  file_size_bytes: number;
  id: number;
  ledger_id: number;
  mime_type: AllowedMimeType;
  reviewed_at: string | null;
  uploaded_at: string;
};

type DocumentStatusRow = Pick<
  LedgerDocument,
  "extraction_status" | "ledger_id"
>;

type AllowedMimeType = "application/pdf" | "text/csv" | "text/plain";
type StoredLedgerDocument = LedgerDocument & {
  storage_bucket: "ledger-documents";
  storage_path: string;
};
type DocumentType =
  | "approval"
  | "contract"
  | "invoice"
  | "other"
  | "purchase_order"
  | "quote"
  | "receipt";

const BUCKET = "ledger-documents";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const documentTypes = new Set<DocumentType>([
  "approval",
  "contract",
  "invoice",
  "other",
  "purchase_order",
  "quote",
  "receipt",
]);
const mimeByExtension: Record<string, AllowedMimeType> = {
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};
const acceptedBrowserMimeTypes: Record<string, ReadonlySet<string>> = {
  ".csv": new Set(["application/csv", "application/vnd.ms-excel", "text/csv"]),
  ".pdf": new Set(["application/pdf"]),
  ".txt": new Set(["text/plain"]),
};
const documentSelect =
  "id,ledger_id,document_type,file_name,mime_type,file_size_bytes,description,extraction_status,extraction_error,uploaded_at,reviewed_at";
const storedDocumentSelect = `${documentSelect},storage_bucket,storage_path`;

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ledgerIdsValue = request.nextUrl.searchParams.get("ledgerIds");

  if (ledgerIdsValue !== null) {
    const ledgerIds = parseLedgerIds(ledgerIdsValue);
    if (ledgerIds === null) {
      return NextResponse.json(
        { error: "ledgerIds must contain between 1 and 250 positive integers." },
        { status: 400 },
      );
    }

    try {
      const documents = await listDocumentStatuses(ledgerIds);
      const readinessByLedgerId: Record<string, {
        failedCount: number;
        processingCount: number;
      }> = Object.fromEntries(
        ledgerIds.map((ledgerId) => [
          ledgerId,
          {
            failedCount: 0,
            processingCount: 0,
          },
        ]),
      );
      for (const document of documents) {
        const summary = readinessByLedgerId[document.ledger_id];
        if (!summary) {
          continue;
        }
        if (document.extraction_status === "failed") {
          summary.failedCount += 1;
        } else if (["pending", "extracting"].includes(document.extraction_status)) {
          summary.processingCount += 1;
        }
      }

      return NextResponse.json({ readinessByLedgerId });
    } catch (error) {
      return documentErrorResponse(error);
    }
  }

  const ledgerId = positiveInteger(request.nextUrl.searchParams.get("ledgerId"));

  if (ledgerId === null) {
    return NextResponse.json(
      { error: "A valid ledgerId query parameter is required." },
      { status: 400 },
    );
  }

  try {
    const documents = await listDocuments(ledgerId);
    return NextResponse.json({ documents });
  } catch (error) {
    return documentErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Document upload must use multipart form data." },
      { status: 400 },
    );
  }

  const ledgerId = positiveInteger(formData.get("ledgerId"));
  const documentType = formData.get("documentType");
  const descriptionValue = formData.get("description");
  const file = formData.get("file");

  if (ledgerId === null) {
    return NextResponse.json({ error: "A valid ledger is required." }, { status: 400 });
  }

  if (typeof documentType !== "string" || !isDocumentType(documentType)) {
    return NextResponse.json({ error: "A valid document type is required." }, { status: 400 });
  }

  const description =
    typeof descriptionValue === "string" ? descriptionValue.trim() : "";
  if (description.length > 500) {
    return NextResponse.json(
      { error: "Document description cannot exceed 500 characters." },
      { status: 400 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a document to upload." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Documents cannot exceed 4 MB." },
      { status: 413 },
    );
  }

  const fileValidation = validateFile(file);
  if ("error" in fileValidation) {
    return NextResponse.json({ error: fileValidation.error }, { status: 400 });
  }

  try {
    await assertLedgerExists(ledgerId);
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    validateFileContent(bytes, fileValidation.mimeType);
    const extractedText = await extractDocumentText(bytes, fileValidation.mimeType);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await findDuplicate(ledgerId, contentHash);

    if (duplicate) {
      if (duplicate.extraction_status !== "ready") {
        const document = await saveExtractedText(duplicate.id, extractedText);
        return NextResponse.json({ document, replayed: true });
      }
      return NextResponse.json({ document: duplicate, replayed: true });
    }

    const storagePath = `${ledgerId}/${randomUUID()}${fileValidation.extension}`;
    await uploadSupabaseStorageObject({
      bucket: BUCKET,
      bytes: arrayBuffer,
      contentType: fileValidation.mimeType,
      path: storagePath,
    });

    const [document] = await supabaseServerRequest<LedgerDocument[]>(
      "/rest/v1/ledger_documents",
      {
        body: [
          {
            content_sha256: contentHash,
            description: description || null,
            document_type: documentType,
            extracted_text: extractedText,
            extraction_status: "ready",
            file_name: file.name.trim(),
            file_size_bytes: file.size,
            ledger_id: ledgerId,
            mime_type: fileValidation.mimeType,
            storage_bucket: BUCKET,
            storage_path: storagePath,
          },
        ],
        method: "POST",
        prefer: "return=representation",
      },
    );

    if (!document) {
      throw new Error("Document metadata was not returned after upload.");
    }

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return documentErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!isObject(payload)) {
    return NextResponse.json({ error: "Document details are required." }, { status: 400 });
  }

  const documentId = positiveInteger(payload.documentId);
  const ledgerId = positiveInteger(payload.ledgerId);
  if (documentId === null || ledgerId === null) {
    return NextResponse.json(
      { error: "Valid documentId and ledgerId values are required." },
      { status: 400 },
    );
  }

  if (payload.action === "extract") {
    try {
      const document = await extractStoredDocument(documentId, ledgerId);
      return NextResponse.json({ document });
    } catch (error) {
      return documentErrorResponse(error);
    }
  }

  try {
    const documents = await supabaseServerRequest<LedgerDocument[]>(
      `/rest/v1/ledger_documents?${new URLSearchParams({
        id: `eq.${documentId}`,
        is_active: "eq.true",
        ledger_id: `eq.${ledgerId}`,
        select: documentSelect,
      })}`,
      {
        body: { is_active: false },
        method: "PATCH",
        prefer: "return=representation",
      },
    );

    if (documents.length === 0) {
      return NextResponse.json({ error: "Document was not found." }, { status: 404 });
    }

    return NextResponse.json({ document: documents[0] });
  } catch (error) {
    return documentErrorResponse(error);
  }
}

async function listDocuments(ledgerId: number) {
  return supabaseServerRequest<LedgerDocument[]>(
    `/rest/v1/ledger_documents?${new URLSearchParams({
      is_active: "eq.true",
      ledger_id: `eq.${ledgerId}`,
      order: "uploaded_at.desc",
      select: documentSelect,
    })}`,
  );
}

async function listDocumentStatuses(ledgerIds: number[]) {
  return supabaseServerRequest<DocumentStatusRow[]>(
    `/rest/v1/ledger_documents?${new URLSearchParams({
      is_active: "eq.true",
      ledger_id: `in.(${ledgerIds.join(",")})`,
      select: "ledger_id,extraction_status",
    })}`,
  );
}

async function assertLedgerExists(ledgerId: number) {
  const ledgers = await supabaseServerRequest<{ id: number }[]>(
    `/rest/v1/erp_ledger?${new URLSearchParams({
      id: `eq.${ledgerId}`,
      limit: "1",
      select: "id",
    })}`,
  );

  if (ledgers.length === 0) {
    throw new DocumentRequestError("Ledger was not found.", 404);
  }
}

async function findDuplicate(ledgerId: number, contentHash: string) {
  const documents = await supabaseServerRequest<LedgerDocument[]>(
    `/rest/v1/ledger_documents?${new URLSearchParams({
      content_sha256: `eq.${contentHash}`,
      is_active: "eq.true",
      ledger_id: `eq.${ledgerId}`,
      limit: "1",
      select: documentSelect,
    })}`,
  );
  return documents[0] ?? null;
}

async function extractStoredDocument(documentId: number, ledgerId: number) {
  const [document] = await supabaseServerRequest<StoredLedgerDocument[]>(
    `/rest/v1/ledger_documents?${new URLSearchParams({
      id: `eq.${documentId}`,
      is_active: "eq.true",
      ledger_id: `eq.${ledgerId}`,
      limit: "1",
      select: storedDocumentSelect,
    })}`,
  );

  if (!document) {
    throw new DocumentRequestError("Document was not found.", 404);
  }

  if (document.extraction_status === "ready") {
    return document;
  }

  await updateDocumentExtraction(document.id, {
    extraction_error: null,
    extraction_status: "extracting",
  });

  try {
    const arrayBuffer = await downloadSupabaseStorageObject({
      bucket: document.storage_bucket,
      path: document.storage_path,
    });
    const extractedText = await extractDocumentText(
      new Uint8Array(arrayBuffer),
      document.mime_type,
    );
    return saveExtractedText(document.id, extractedText);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : "Extraction failed.";
    const failed = await updateDocumentExtraction(document.id, {
      extracted_text: null,
      extraction_error: message,
      extraction_status: "failed",
    });

    if (error instanceof DocumentExtractionError) {
      return failed;
    }
    throw error;
  }
}

async function saveExtractedText(documentId: number, extractedText: string) {
  return updateDocumentExtraction(documentId, {
    extracted_text: extractedText,
    extraction_error: null,
    extraction_status: "ready",
  });
}

async function updateDocumentExtraction(
  documentId: number,
  payload: Record<string, unknown>,
) {
  const [document] = await supabaseServerRequest<LedgerDocument[]>(
    `/rest/v1/ledger_documents?${new URLSearchParams({
      id: `eq.${documentId}`,
      select: documentSelect,
    })}`,
    {
      body: payload,
      method: "PATCH",
      prefer: "return=representation",
    },
  );

  if (!document) {
    throw new Error("Document metadata was not returned after extraction.");
  }

  return document;
}

function validateFile(file: File):
  | { extension: string; mimeType: AllowedMimeType }
  | { error: string } {
  const fileName = file.name.trim();
  if (!fileName || fileName.length > 255) {
    return { error: "Document filename must be between 1 and 255 characters." };
  }

  const extensionMatch = /\.[^.]+$/.exec(fileName.toLowerCase());
  const extension = extensionMatch?.[0] ?? "";
  const expectedMimeType = mimeByExtension[extension];
  if (!expectedMimeType) {
    return { error: "Only PDF, TXT, and CSV documents are accepted." };
  }

  if (file.type && !acceptedBrowserMimeTypes[extension].has(file.type)) {
    return { error: "The document type does not match its filename." };
  }

  return { extension, mimeType: expectedMimeType };
}

function validateFileContent(bytes: Uint8Array, mimeType: AllowedMimeType) {
  if (mimeType === "application/pdf") {
    const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") {
      throw new DocumentRequestError("The selected PDF is not valid.", 400);
    }
    return;
  }

  if (bytes.includes(0)) {
    throw new DocumentRequestError("Text evidence cannot contain binary data.", 400);
  }
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function parseLedgerIds(value: string) {
  const ledgerIds = [...new Set(value.split(",").map(positiveInteger))];
  if (
    ledgerIds.length === 0 ||
    ledgerIds.length > 250 ||
    ledgerIds.some((ledgerId) => ledgerId === null)
  ) {
    return null;
  }
  return ledgerIds as number[];
}

function isDocumentType(value: string): value is DocumentType {
  return documentTypes.has(value as DocumentType);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class DocumentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DocumentRequestError";
  }
}

function documentErrorResponse(error: unknown) {
  const status =
    error instanceof DocumentRequestError
      ? error.status
      : error instanceof DocumentExtractionError
        ? 422
        : 500;

  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Document request failed.",
    },
    { status },
  );
}
