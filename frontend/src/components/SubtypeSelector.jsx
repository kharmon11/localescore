const SUBTYPES = [
  { value: "coffee_shop", label: "Coffee shop / cafe" },
  { value: "fast_casual", label: "Fast casual / QSR" },
  { value: "dinner_destination", label: "Sit-down / dinner destination" },
];

const styles = {
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

export default function SubtypeSelector({ value, onChange }) {
  return (
    <div style={styles.wrap}>
      <label style={styles.label} htmlFor="subtype-select">
        Concept
      </label>
      <select
        id="subtype-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
