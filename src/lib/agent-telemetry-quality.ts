const forbiddenNarratives = new Set([
  "short string",
  "short evidence summary",
  "short evidence hypothesis",
  "short test",
  "short test that could disprove the concern",
]);

const forbiddenEvidenceNames = new Set(["field_name", "field_name_or_document"]);

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isMeaningfulTelemetryNarrative(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const cleaned = value.trim().replace(/\s+/g, " ");
  const normalized = normalize(cleaned);

  return (
    cleaned.length >= 12 &&
    !forbiddenNarratives.has(normalized) &&
    !(cleaned.startsWith("<") && cleaned.endsWith(">"))
  );
}

export function hasMeaningfulEvidenceNames(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        !forbiddenEvidenceNames.has(normalize(item)) &&
        !(item.trim().startsWith("<") && item.trim().endsWith(">")),
    )
  );
}

export const telemetryCorrectionInstruction = [
  "The previous response violated the required protocol.",
  "Fix the reported protocol_violation and follow the original protocol and response_contract exactly.",
  "Return the same JSON shape for this exact ledger.",
  "Include a nonempty answer, a confidence_score between 0 and 1, an evidence_needed array, and a read-only protocol_action.",
  "Write a concrete hypothesis grounded in provided ledger fields or values.",
  "Write a specific falsification check that could disprove that hypothesis.",
  "Do not copy angle-bracket instructions or placeholder example text.",
].join(" ");
