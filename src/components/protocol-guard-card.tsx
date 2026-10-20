type ProtocolGuardCardProps = {
  compact?: boolean;
};

const protocolRules = [
  "Agent output must match the structured response contract.",
  "Only erp_ledger.status may be proposed for ledger updates.",
  "Human review actions map to approved, review, or duplicate status.",
  "Read-only ledger fields are blocked by Python before writes.",
];

export function ProtocolGuardCard({ compact = false }: ProtocolGuardCardProps) {
  return (
    <section className="rounded-lg border border-teal-200 bg-teal-50/70 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-800">
            Protocol Guard
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[#102522]">
            Agent confined to permitted database actions
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#526260]">
            The model can recommend work, but Python validates the contract and
            blocks any write outside the approved table and column boundary.
          </p>
        </div>
        <div className="w-fit rounded-full border border-teal-300 bg-white px-3 py-1 text-xs font-semibold text-teal-800">
          erp_ledger.status only
        </div>
      </div>

      {!compact ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {protocolRules.map((rule) => (
            <div
              className="rounded-lg border border-teal-200 bg-white px-4 py-3 text-sm leading-6 text-[#2b3d3a]"
              key={rule}
            >
              {rule}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
