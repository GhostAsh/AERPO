import assert from "node:assert/strict";
import test from "node:test";
import { matchesColumnFilters } from "../src/lib/table-filters.ts";

const columns = [
  { key: "description", label: "Description" },
  { key: "status", label: "Status", options: [{ value: "review", label: "Review" }] },
  { key: "amount", label: "Amount", type: "number" },
  { key: "date", label: "Date", type: "date" },
];
const row = { description: "Vendor invoice variance", status: "review", amount: "18420.50", date: "2026-10-25T23:00:00Z" };
const matches = (filters, cells = row) => matchesColumnFilters(cells, filters, columns);

test("text filters ignore case and surrounding whitespace; dropdowns match exactly", () => {
  assert.equal(matches({ description: "  INVOICE  ", status: "review" }), true);
  assert.equal(matches({ description: "missing invoice" }), false);
  assert.equal(matches({ status: "view" }), false);
});

test("numeric bounds are inclusive and support decimals and negative values", () => {
  assert.equal(matches({ amountMin: "18420.5", amountMax: "18420.5" }), true);
  assert.equal(matches({ amountMin: "18420.51" }), false);
  assert.equal(matches({ amountMax: "18420.49" }), false);
  assert.equal(matches({ amountMin: "-10", amountMax: "0" }, { ...row, amount: -5 }), true);
  assert.equal(matches({ amountMin: "20000", amountMax: "100" }), false);
});

test("date bounds include the full end day and support open ranges", () => {
  assert.equal(matches({ dateMin: "2026-10-25", dateMax: "2026-10-25" }), true);
  assert.equal(matches({ dateMin: "2026-10-26" }), false);
  assert.equal(matches({ dateMax: "2026-10-24" }), false);
  assert.equal(matches({ dateMax: "2026-10-25" }), true);
});

test("missing values remain visible until their column is filtered", () => {
  const empty = { description: null, amount: null, date: null, status: null };
  assert.equal(matches({}, empty), true);
  assert.equal(matches({ description: "invoice" }, empty), false);
  assert.equal(matches({ amountMin: "0" }, empty), false);
  assert.equal(matches({ dateMin: "2026-01-01" }, empty), false);
  assert.equal(matches({ amountMin: "0" }, { ...row, amount: "unknown" }), false);
});

test("multiple column filters combine and clearing restores the loaded rows", () => {
  const rows = [row, { ...row, status: "approved" }, { ...row, amount: 20 }];
  const filters = { description: "vendor", status: "review", amountMin: "100" };
  assert.deepEqual(rows.filter((cells) => matches(filters, cells)), [row]);
  assert.equal(rows.filter((cells) => matches({}, cells)).length, 3);
});

test("active filters apply to newly received live data", () => {
  const filters = { status: "review", amountMin: "100" };
  assert.equal(matches(filters), true);
  assert.equal(matches(filters, { ...row, status: "approved" }), false);
  assert.equal(matches(filters, { ...row, amount: 25 }), false);
});
