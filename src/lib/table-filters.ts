export type FilterColumn = {
  key: string;
  label: string;
  type?: "number" | "date";
  options?: { value: string; label: string }[];
};

export type ColumnFilters = Record<string, string>;

export function matchesColumnFilters(
  cells: Record<string, unknown>,
  filters: ColumnFilters,
  columns: FilterColumn[],
): boolean {
  return columns.every((column) => {
    const cell = cells[column.key];
    if (column.type) {
      const min = filters[`${column.key}Min`] ?? "";
      const max = filters[`${column.key}Max`] ?? "";
      if (!min && !max) return true;
      if (cell === null || cell === undefined || cell === "") return false;
      if (column.type === "number") {
        const value = Number(cell);
        return Number.isFinite(value) && (!min || value >= Number(min)) && (!max || value <= Number(max));
      }
      const date = String(cell).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!min || date >= min) && (!max || date <= max);
    }
    const query = (filters[column.key] ?? "").trim().toLowerCase();
    if (!query) return true;
    const value = String(cell ?? "").toLowerCase();
    return column.options ? value === query : value.includes(query);
  });
}
