import type { CSSProperties } from "react";

const SUBTYPES = [
  { value: "coffee_shop", label: "Coffee shop / cafe" },
  { value: "fast_casual", label: "Fast casual / QSR" },
  { value: "dinner_destination", label: "Sit-down / dinner destination" },
] as const;

// Derived from SUBTYPES (the one canonical list) rather than hand-written,
// same "avoid a second, drift-prone copy" reasoning as the backend's Subtype.
export type Subtype = (typeof SUBTYPES)[number]["value"];

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  label: {
    fontSize: 12,
    color: "#52514e",
  },
  select: {
    fontSize: 14,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #e1e0d9",
    background: "#fcfcfb",
    color: "#0b0b0b",
  },
};

interface SubtypeSelectorProps {
  value: Subtype;
  onChange: (value: Subtype) => void;
}

export default function SubtypeSelector({ value, onChange }: SubtypeSelectorProps) {
  return (
    <div style={styles.wrap}>
      <label style={styles.label} htmlFor="subtype-select">
        Concept
      </label>
      <select
        id="subtype-select"
        value={value}
        // The DOM only knows e.target.value is a string; this app is the one
        // that knows it can only ever be one of the three <option> values
        // below, same reasoning as the backend's post-validation subtype casts.
        onChange={(e) => onChange(e.target.value as Subtype)}
        style={styles.select}
      >
        {SUBTYPES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
