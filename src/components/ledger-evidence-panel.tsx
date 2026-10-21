"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DropdownIndicator } from "@/components/dropdown-indicator";
import { readJsonResponse } from "@/lib/http/read-json-response";

type LedgerDocument = {
  description: string | null;
  document_type: string;
  extraction_error: string | null;
  extraction_status: "pending" | "extracting" | "ready" | "failed";
  file_name: string;
  file_size_bytes: number;
  id: number;
  ledger_id: number;
  mime_type: string;
  reviewed_at: string | null;
  uploaded_at: string;
};

export type EvidenceReadiness = "error" | "loading" | "processing" | "ready";

const documentTypeOptions = [
  ["invoice", "Invoice"],
  ["purchase_order", "Purchase order"],
  ["quote", "Quote"],
  ["contract", "Contract"],
  ["approval", "Approval"],
  ["receipt", "Receipt"],
  ["other", "Other evidence"],
] as const;

const statusLabels: Record<LedgerDocument["extraction_status"], string> = {
  extracting: "Extracting",
  failed: "Extraction failed",
  pending: "Pending extraction",
  ready: "Ready for review",
};

const statusStyles: Record<LedgerDocument["extraction_status"], string> = {
  extracting: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  failed: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  pending: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  ready: "border-teal-300/30 bg-teal-300/10 text-teal-100",
};

export function LedgerEvidencePanel({
  ledgerId,
  onReadinessChange,
}: {
  ledgerId: number;
  onReadinessChange?: (readiness: EvidenceReadiness) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [description, setDescription] = useState("");
  const [documentType, setDocumentType] = useState("invoice");
  const [documents, setDocuments] = useState<LedgerDocument[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const processingCount = documents.filter((document) =>
    ["pending", "extracting"].includes(document.extraction_status),
  ).length;
  const failedCount = documents.filter(
    (document) => document.extraction_status === "failed",
  ).length;
  const readiness: EvidenceReadiness =
    status === "loading"
      ? "loading"
      : status === "error"
        ? "error"
        : processingCount > 0
          ? "processing"
          : "ready";

  useEffect(() => {
    onReadinessChange?.(readiness);
  }, [onReadinessChange, readiness]);

  useEffect(() => {
    let isMounted = true;

    async function loadDocuments() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const response = await fetch(
          `/internal-api/ledger-documents?ledgerId=${ledgerId}`,
        );
        const result = await readJsonResponse<
          { documents: LedgerDocument[] } | { error: string }
        >(response, "Document service returned an unexpected response.");

        if (!response.ok || "error" in result) {
          throw new Error("error" in result ? result.error : "Documents could not be loaded.");
        }

        if (isMounted) {
          setDocuments(
            result.documents.map((document) =>
              document.extraction_status === "pending"
                ? { ...document, extraction_status: "extracting" as const }
                : document,
            ),
          );
          setStatus("ready");

          const pendingDocuments = result.documents.filter((document) =>
            ["pending", "extracting"].includes(document.extraction_status),
          );
          await Promise.all(
            pendingDocuments.map(async (document) => {
              const extractionResponse = await fetch(
                "/internal-api/ledger-documents",
                {
                  body: JSON.stringify({
                    action: "extract",
                    documentId: document.id,
                    ledgerId,
                  }),
                  headers: { "Content-Type": "application/json" },
                  method: "PATCH",
                },
              );
              const extractionResult = await readJsonResponse<
                { document: LedgerDocument } | { error: string }
              >(
                extractionResponse,
                "Document extraction returned an unexpected response.",
              );

              if (!extractionResponse.ok || "error" in extractionResult) {
                throw new Error(
                  "error" in extractionResult
                    ? extractionResult.error
                    : "Document extraction failed.",
                );
              }

              if (isMounted) {
                setDocuments((current) =>
                  current.map((currentDocument) =>
                    currentDocument.id === document.id
                      ? extractionResult.document
                      : currentDocument,
                  ),
                );
              }
            }),
          );
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : "Documents could not be loaded.",
          );
          setStatus("error");
        }
      }
    }

    loadDocuments();
    return () => {
      isMounted = false;
    };
  }, [ledgerId]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || isUploading) {
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    try {
      const body = new FormData();
      body.set("description", description.trim());
      body.set("documentType", documentType);
      body.set("file", file);
      body.set("ledgerId", String(ledgerId));

      const response = await fetch("/internal-api/ledger-documents", {
        body,
        method: "POST",
      });
      const result = await readJsonResponse<
        { document: LedgerDocument } | { error: string }
      >(response, "Document service returned an unexpected response.");

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Document upload failed.");
      }

      setDocuments((current) => [result.document, ...current]);
      setDescription("");
      setStatus("ready");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Document upload failed.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function removeDocument(documentId: number) {
    if (removingId !== null) {
      return;
    }

    setRemovingId(documentId);
    setErrorMessage(null);

    try {
      const response = await fetch("/internal-api/ledger-documents", {
        body: JSON.stringify({ documentId, ledgerId }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = await readJsonResponse<
        { document: LedgerDocument } | { error: string }
      >(response, "Document service returned an unexpected response.");

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Document could not be removed.");
      }

      setDocuments((current) =>
        current.filter((document) => document.id !== documentId),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Document could not be removed.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  async function retryExtraction(documentId: number) {
    if (retryingId !== null) {
      return;
    }

    setRetryingId(documentId);
    setErrorMessage(null);
    setDocuments((current) =>
      current.map((document) =>
        document.id === documentId
          ? {
              ...document,
              extraction_error: null,
              extraction_status: "extracting",
            }
          : document,
      ),
    );

    try {
      const response = await fetch("/internal-api/ledger-documents", {
        body: JSON.stringify({ action: "extract", documentId, ledgerId }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = await readJsonResponse<
        { document: LedgerDocument } | { error: string }
      >(response, "Document extraction returned an unexpected response.");

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result ? result.error : "Document extraction failed.",
        );
      }

      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId ? result.document : document,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Document extraction failed.";
      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId
            ? {
                ...document,
                extraction_error: message,
                extraction_status: "failed",
              }
            : document,
        ),
      );
      setErrorMessage(message);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="mt-6 border-t border-white/12 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Evidence documents</h3>
        <span className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-[#c7d8d4]">
          {documents.length}
        </span>
      </div>

      {processingCount > 0 ? (
        <p className="mt-3 text-xs font-medium text-sky-100" role="status">
          Processing {processingCount} evidence document
          {processingCount === 1 ? "" : "s"}.
        </p>
      ) : failedCount > 0 ? (
        <p className="mt-3 text-xs font-medium text-rose-100" role="status">
          {failedCount} document{failedCount === 1 ? " needs" : "s need"} extraction retry.
        </p>
      ) : documents.length > 0 ? (
        <p className="mt-3 text-xs font-medium text-teal-100" role="status">
          Attached evidence is ready for agent review.
        </p>
      ) : null}

      <form className="mt-4 space-y-3" onSubmit={uploadDocument}>
        <div className="dropdown-control">
          <select
            aria-label="Evidence document type"
            className="h-10 w-full rounded-md border border-white/12 bg-white/[0.08] px-3 text-sm font-semibold text-white outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20"
            disabled={isUploading}
            onChange={(event) => setDocumentType(event.target.value)}
            value={documentType}
          >
            {documentTypeOptions.map(([value, label]) => (
              <option className="bg-[#18312d]" key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <DropdownIndicator dark />
        </div>
        <input
          accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
          className="block w-full rounded-md border border-white/12 bg-white/[0.08] p-2 text-sm text-[#d3dddb] file:mr-3 file:rounded-md file:border-0 file:bg-teal-200 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#102522] hover:file:bg-teal-100 disabled:opacity-50"
          disabled={isUploading}
          ref={fileInputRef}
          required
          type="file"
        />
        <input
          className="h-10 w-full rounded-md border border-white/12 bg-white/[0.08] px-3 text-sm text-white outline-none transition placeholder:text-[#9fb0ad] focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20"
          disabled={isUploading}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional document context"
          value={description}
        />
        <button
          className="h-10 w-full rounded-md bg-teal-200 px-3 text-sm font-semibold text-[#102522] transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isUploading}
          type="submit"
        >
          {isUploading ? "Uploading..." : "Upload evidence"}
        </button>
      </form>

      {errorMessage ? (
        <p className="mt-3 rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-100">
          {errorMessage}
        </p>
      ) : null}

      {status === "loading" ? (
        <p className="mt-4 text-sm text-[#b8c8c5]">Loading evidence...</p>
      ) : null}

      {status === "ready" && documents.length === 0 ? (
        <p className="mt-4 rounded-md border border-white/12 bg-white/[0.04] p-3 text-sm text-[#b8c8c5]">
          No evidence documents attached.
        </p>
      ) : null}

      {documents.length > 0 ? (
        <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-md border border-white/12">
          {documents.map((document) => (
            <div className="bg-white/[0.04] p-3" key={document.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-white">
                    {document.file_name}
                  </p>
                  <p className="mt-1 text-xs capitalize text-[#b8c8c5]">
                    {document.document_type.replaceAll("_", " ")} ·{" "}
                    {formatFileSize(document.file_size_bytes)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-[0.65rem] font-semibold ${statusStyles[document.extraction_status]}`}
                >
                  {statusLabels[document.extraction_status]}
                </span>
              </div>
              {document.description ? (
                <p className="mt-2 text-sm leading-5 text-[#d3dddb]">
                  {document.description}
                </p>
              ) : null}
              {document.extraction_error ? (
                <p className="mt-2 text-xs text-rose-100">
                  {document.extraction_error}
                </p>
              ) : null}
              <div className="mt-2 flex justify-end gap-2">
                {document.extraction_status === "failed" ? (
                  <button
                    className="rounded-md border border-teal-300/30 px-2 py-1 text-xs font-semibold text-teal-100 transition hover:bg-teal-300/10 disabled:opacity-50"
                    disabled={retryingId !== null || removingId !== null}
                    onClick={() => retryExtraction(document.id)}
                    type="button"
                  >
                    {retryingId === document.id ? "Retrying..." : "Retry extraction"}
                  </button>
                ) : null}
                <button
                  className="rounded-md border border-white/12 px-2 py-1 text-xs font-semibold text-[#c7d8d4] transition hover:border-rose-300/30 hover:bg-rose-300/10 hover:text-rose-100 disabled:opacity-50"
                  disabled={removingId !== null || retryingId !== null}
                  onClick={() => removeDocument(document.id)}
                  type="button"
                >
                  {removingId === document.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
