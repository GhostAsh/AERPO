import "server-only";

import { supabaseServerRequest } from "@/lib/supabase/server";

export type LedgerDocumentEvidence = {
  description: string | null;
  document_type: string;
  extracted_text: string | null;
  extraction_status: "pending" | "extracting" | "ready" | "failed";
  file_name: string;
  id: number;
};

const MAX_DOCUMENT_CHARACTERS = 6_000;
const MAX_TOTAL_CHARACTERS = 12_000;

export async function getLedgerDocumentEvidence(ledgerId: number) {
  const documents = await supabaseServerRequest<LedgerDocumentEvidence[]>(
    `/rest/v1/ledger_documents?${new URLSearchParams({
      is_active: "eq.true",
      ledger_id: `eq.${ledgerId}`,
      limit: "10",
      order: "uploaded_at.desc",
      select:
        "id,document_type,file_name,description,extraction_status,extracted_text",
    })}`,
  );

  let remainingCharacters = MAX_TOTAL_CHARACTERS;

  return documents.map((document) => {
    const text =
      document.extraction_status === "ready" &&
      typeof document.extracted_text === "string" &&
      remainingCharacters > 0
        ? document.extracted_text.slice(
            0,
            Math.min(MAX_DOCUMENT_CHARACTERS, remainingCharacters),
          )
        : null;

    remainingCharacters -= text?.length ?? 0;

    return { ...document, extracted_text: text };
  });
}
