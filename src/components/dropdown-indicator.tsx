export function DropdownIndicator({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`dropdown-arrow ${dark ? "dropdown-arrow-dark" : ""}`}
    >
      <span className="dropdown-chevron" />
    </span>
  );
}
