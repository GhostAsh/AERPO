"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DropdownIndicator } from "@/components/dropdown-indicator";
import { readJsonResponse } from "@/lib/http/read-json-response";
import {
  ErpLedgerRow,
  LEDGER_CREATED_EVENT,
} from "@/lib/ledger/use-ledger-rows";

type FormValues = {
  amount: string;
  department: string;
  description: string;
  optimizationNotes: string;
  transactionDate: string;
};

type SubmissionState = "idle" | "creating" | "uploading" | "reviewing";

type FailureStage = "ledger" | "evidence" | "review";

type OptimizerResult = {
  correction_ids?: number[];
  existing_correction_ids?: number[];
  status_updates?: Array<{ ledger_id: number; status: string }>;
};

const departments = [
  "Finance",
  "IT",
  "Operations",
  "Procurement",
  "Software Development",
] as const;

const documentTypes = [
  ["invoice", "Invoice"],
  ["purchase_order", "Purchase order"],
  ["quote", "Quote"],
  ["contract", "Contract"],
  ["approval", "Approval"],
  ["receipt", "Receipt"],
  ["other", "Other evidence"],
] as const;

const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

const initialValues = (): FormValues => ({
  amount: "",
  department: "",
  description: "",
  optimizationNotes: "",
  transactionDate: localDateValue(),
});

export function CreateLedgerDialog({ compact = false }: { compact?: boolean }) {
  const evidenceFileRef = useRef<HTMLInputElement | null>(null);
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceDocumentType, setEvidenceDocumentType] = useState("invoice");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isCustomDepartment, setIsCustomDepartment] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "warning";
  } | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const [values, setValues] = useState<FormValues>(initialValues);
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const isSaving = submissionState !== "idle";

  function resetForm() {
    setValues(initialValues());
    setIsCustomDepartment(false);
    setEvidenceDescription("");
    setEvidenceDocumentType("invoice");
    setErrorMessage(null);
    setProgressMessage(null);
    if (evidenceFileRef.current) {
      evidenceFileRef.current.value = "";
    }
    idempotencyRef.current = null;
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, isSaving]);

  async function createLedger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const shouldReview = submitter?.value === "review";
    const evidenceFile = evidenceFileRef.current?.files?.[0] ?? null;
    const evidenceValidationError = validateEvidenceFile(evidenceFile);

    if (evidenceValidationError) {
      setErrorMessage(evidenceValidationError);
      return;
    }

    setErrorMessage(null);
    setNotice(null);
    setProgressMessage("Creating ledger...");
    setSubmissionState("creating");

    const fingerprint = JSON.stringify(values);

    if (idempotencyRef.current?.fingerprint !== fingerprint) {
      idempotencyRef.current = {
        fingerprint,
        key:
          globalThis.crypto?.randomUUID?.() ??
          `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }

    let createdLedger: ErpLedgerRow | null = null;
    let failureStage: FailureStage = "ledger";
    let evidenceWasAttached = false;

    try {
      const response = await fetch("/internal-api/ledgers", {
        body: JSON.stringify({
          amount: values.amount,
          department: values.department,
          description: values.description,
          optimizationNotes: values.optimizationNotes,
          transactionDate: values.transactionDate,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyRef.current.key,
        },
        method: "POST",
      });
      const result = (await response.json()) as
        | { ledger: ErpLedgerRow; replayed?: boolean }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result ? result.error : "Ledger could not be created.",
        );
      }

      createdLedger = result.ledger;

      if (!result.replayed) {
        window.dispatchEvent(
          new CustomEvent<ErpLedgerRow>(LEDGER_CREATED_EVENT, {
            detail: result.ledger,
          }),
        );
      }

      if (evidenceFile) {
        failureStage = "evidence";
        setSubmissionState("uploading");
        setProgressMessage(
          `Ledger #${result.ledger.id} created. Attaching evidence...`,
        );

        const formData = new FormData();
        formData.set("description", evidenceDescription.trim());
        formData.set("documentType", evidenceDocumentType);
        formData.set("file", evidenceFile);
        formData.set("ledgerId", String(result.ledger.id));

        const documentResponse = await fetch("/internal-api/ledger-documents", {
          body: formData,
          method: "POST",
        });
        const documentResult = await readJsonResponse<
          { document: { id: number }; replayed?: boolean } | { error: string }
        >(
          documentResponse,
          "Document service returned an unexpected response.",
        );

        if (!documentResponse.ok || "error" in documentResult) {
          throw new Error(
            "error" in documentResult
              ? documentResult.error
              : "Evidence could not be attached.",
          );
        }

        evidenceWasAttached = true;
      }

      if (shouldReview) {
        failureStage = "review";
        setSubmissionState("reviewing");
        setProgressMessage(
          evidenceWasAttached
            ? `Evidence attached to ledger #${result.ledger.id}. Agent is thinking...`
            : `Ledger #${result.ledger.id} created. Agent is thinking...`,
        );

        const optimizerResponse = await fetch("/api/optimizer/run", {
          body: JSON.stringify({ ledgerId: result.ledger.id }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const optimizerResult = await readJsonResponse<
          OptimizerResult | { error: string }
        >(
          optimizerResponse,
          "Agent service returned an unexpected response.",
        );

        if (!optimizerResponse.ok || "error" in optimizerResult) {
          throw new Error(
            "error" in optimizerResult
              ? optimizerResult.error
              : "Agent review could not be started.",
          );
        }

        const updatedStatus = optimizerResult.status_updates?.find(
          (update) => update.ledger_id === result.ledger.id,
        )?.status;
        const outcome = updatedStatus
          ? ` Status updated to ${updatedStatus}.`
          : (optimizerResult.correction_ids?.length ?? 0) > 0
            ? " A correction proposal is ready for review."
            : (optimizerResult.existing_correction_ids?.length ?? 0) > 0
              ? " An existing correction proposal is still awaiting review."
            : " Agent review completed without changing the ledger.";

        setNotice({
          message: `Ledger #${result.ledger.id} created${evidenceWasAttached ? " with evidence" : ""} and reviewed.${outcome}`,
          tone: "success",
        });
      } else {
        setNotice({
          message: `Ledger #${result.ledger.id} created${evidenceWasAttached ? " with evidence" : ""} and queued.`,
          tone: "success",
        });
      }

      resetForm();
      setIsOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Ledger could not be created.";

      if (createdLedger) {
        if (failureStage === "evidence") {
          setErrorMessage(
            `Ledger #${createdLedger.id} was created, but its evidence was not attached: ${message} Submit again to retry the attachment without creating another ledger.`,
          );
          setProgressMessage(null);
          return;
        }

        setNotice({
          message: `Ledger #${createdLedger.id} was created${evidenceWasAttached ? " with evidence" : ""}, but agent review failed: ${message}`,
          tone: "warning",
        });
        resetForm();
        setIsOpen(false);
      } else {
        setErrorMessage(message);
        setProgressMessage(null);
      }
    } finally {
      setSubmissionState("idle");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {notice ? (
        <p
          className={`text-sm font-medium ${notice.tone === "success" ? "text-emerald-800" : "text-amber-800"}`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}
      <button
        className={compact ? "scorecard-primary" : "h-10 rounded-md bg-[#102522] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1c3b36]"}
        onClick={() => {
          setErrorMessage(null);
          setNotice(null);
          setIsOpen(true);
        }}
        type="button"
      >
        Create ledger
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#102522]/35 p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !isSaving) {
              setIsOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="create-ledger-title"
            aria-modal="true"
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#c8d3d1] bg-white p-6 shadow-xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                  New financial record
                </p>
                <h2
                  className="mt-2 text-2xl font-semibold text-[#102522]"
                  id="create-ledger-title"
                >
                  Create ledger
                </h2>
              </div>
              <button
                aria-label="Close create ledger dialog"
                className="size-10 rounded-md border border-[#c8d3d1] text-lg font-semibold text-[#526260] transition hover:bg-[#f4f7f6]"
                disabled={isSaving}
                onClick={() => setIsOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={createLedger}>
              <FormField label="Transaction date">
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      transactionDate: event.target.value,
                    }))
                  }
                  required
                  type="date"
                  value={values.transactionDate}
                />
              </FormField>
              <FormField label="Amount">
                <input
                  className={inputClassName}
                  inputMode="decimal"
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  placeholder="0.00"
                  required
                  step="0.01"
                  type="number"
                  value={values.amount}
                />
              </FormField>
              <FormField label="Department">
                <div className="dropdown-control">
                  <select
                    className={inputClassName}
                    onChange={(event) => {
                      const isCustom = event.target.value === "custom";
                      setIsCustomDepartment(isCustom);
                      setValues((current) => ({
                        ...current,
                        department: isCustom ? "" : event.target.value,
                      }));
                    }}
                    required
                    value={isCustomDepartment ? "custom" : values.department}
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                    <option value="custom">Other department</option>
                  </select>
                  <DropdownIndicator />
                </div>
              </FormField>
              <FormField label="Description">
                <input
                  className={inputClassName}
                  maxLength={240}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Vendor invoice or ledger purpose"
                  required
                  value={values.description}
                />
              </FormField>
              {isCustomDepartment ? (
                <div className="sm:col-span-2">
                  <FormField label="Custom department">
                    <input
                      autoFocus
                      className={inputClassName}
                      maxLength={80}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          department: event.target.value,
                        }))
                      }
                      placeholder="Enter department name"
                      required
                      value={values.department}
                    />
                  </FormField>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <FormField label="Review context">
                  <textarea
                    className={`${inputClassName} min-h-28 resize-y py-3`}
                    maxLength={500}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        optimizationNotes: event.target.value,
                      }))
                    }
                    placeholder="Optional context for human and agent review"
                    value={values.optimizationNotes}
                  />
                </FormField>
              </div>

              <fieldset className="grid gap-4 border-t border-[#dce4e2] pt-5 sm:col-span-2 sm:grid-cols-2">
                <legend className="mb-4 text-sm font-semibold text-[#2b3d3a]">
                  Supporting evidence
                </legend>
                <FormField label="Document type">
                  <div className="dropdown-control">
                    <select
                      className={inputClassName}
                      disabled={isSaving}
                      onChange={(event) =>
                        setEvidenceDocumentType(event.target.value)
                      }
                      value={evidenceDocumentType}
                    >
                      {documentTypes.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <DropdownIndicator />
                  </div>
                </FormField>
                <FormField label="Document">
                  <input
                    accept=".csv,.pdf,.txt,application/pdf,text/csv,text/plain"
                    className={`${inputClassName} py-2 file:mr-3 file:rounded file:border-0 file:bg-[#e6f3f0] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-teal-900`}
                    disabled={isSaving}
                    ref={evidenceFileRef}
                    type="file"
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="Evidence context">
                    <input
                      className={inputClassName}
                      disabled={isSaving}
                      maxLength={500}
                      onChange={(event) =>
                        setEvidenceDescription(event.target.value)
                      }
                      placeholder="Optional note about the supporting document"
                      value={evidenceDescription}
                    />
                  </FormField>
                </div>
              </fieldset>

              {errorMessage ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 sm:col-span-2">
                  {errorMessage}
                </p>
              ) : null}

              {progressMessage ? (
                <p
                  className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm font-medium text-sky-900 sm:col-span-2"
                  role="status"
                >
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin rounded-full border-2 border-sky-700 border-r-transparent"
                  />
                  {progressMessage}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 sm:col-span-2">
                <button
                  className="h-10 rounded-md border border-[#c8d3d1] px-4 text-sm font-semibold text-[#526260] transition hover:bg-[#f4f7f6]"
                  disabled={isSaving}
                  onClick={() => setIsOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-900 transition hover:bg-teal-50 disabled:cursor-wait disabled:opacity-60"
                  disabled={isSaving}
                  name="intent"
                  type="submit"
                  value="create"
                >
                  {submissionState === "creating"
                    ? "Creating..."
                    : submissionState === "uploading"
                      ? "Attaching evidence..."
                      : "Create"}
                </button>
                <button
                  className="h-10 rounded-md bg-[#102522] px-4 text-sm font-semibold text-white transition hover:bg-[#1c3b36] disabled:cursor-wait disabled:opacity-60"
                  disabled={isSaving}
                  name="intent"
                  type="submit"
                  value="review"
                >
                  {submissionState === "reviewing"
                    ? "Agent thinking..."
                    : submissionState === "uploading"
                      ? "Attaching evidence..."
                    : submissionState === "creating"
                      ? "Creating..."
                      : "Create and review"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function FormField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#2b3d3a]">
      {label}
      {children}
    </label>
  );
}

const inputClassName =
  "h-11 w-full rounded-md border border-[#c8d3d1] bg-white px-3 text-sm text-[#102522] outline-none transition placeholder:text-[#8a9694] focus:border-teal-500 focus:ring-2 focus:ring-teal-100";

function localDateValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function validateEvidenceFile(file: File | null) {
  if (!file) {
    return null;
  }

  const extension = /\.[^.]+$/.exec(file.name.toLowerCase())?.[0];
  if (!extension || ![".csv", ".pdf", ".txt"].includes(extension)) {
    return "Supporting evidence must be a PDF, TXT, or CSV document.";
  }

  if (file.size === 0) {
    return "The supporting document is empty.";
  }

  if (file.size > MAX_EVIDENCE_BYTES) {
    return "Supporting evidence cannot exceed 4 MB.";
  }

  return null;
}
