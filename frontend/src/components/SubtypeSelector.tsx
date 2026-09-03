import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

// Descriptions summarize docs/design.md 2.1 and 2.2 (trade-area radius,
// travel mode, and what each subtype's weights emphasize) at UI length
// rather than doc length.
export const SUBTYPES = [
  {
    value: "coffee_shop",
    label: "Coffee shop / cafe",
    description:
      "Short walk radius (5- and 10-minute walk isochrones). Weighs morning and commuter traffic and nearby office & transit density most heavily.",
  },
  {
    value: "fast_casual",
    label: "Fast casual / QSR (quick service restaurant)",
    description:
      "Mid drive-time radius (5- and 10-minute drive isochrones). Weighs daytime population and visibility from arterial roads most heavily.",
  },
  {
    value: "dinner_destination",
    label: "Sit-down / dinner destination",
    description:
      "Larger drive-time radius (10- and 20-minute drive isochrones). Weighs household income and evening residential density most; visibility matters less.",
  },
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
    position: "relative",
  },
  labelRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  label: {
    fontSize: 12,
    color: "#52514e",
  },
  infoButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    padding: 0,
    fontSize: 15,
    lineHeight: 1,
    color: "#46a",
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  select: {
    fontSize: 14,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #e1e0d9",
    background: "#fcfcfb",
    color: "#0b0b0b",
  },
  popover: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 4,
    width: 300,
    background: "#0b0b0b",
    color: "#fcfcfb",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
    zIndex: 2,
  },
  popoverItem: {
    padding: "6px 0",
  },
  popoverItemLabel: {
    fontWeight: 600,
    marginBottom: 2,
  },
  popoverDivider: {
    border: "none",
    borderTop: "1px solid rgba(255, 255, 255, 0.25)",
    margin: 0,
  },
};

interface SubtypeSelectorProps {
  value: Subtype;
  onChange: (value: Subtype) => void;
}

export default function SubtypeSelector({ value, onChange }: SubtypeSelectorProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Closes the popover on an outside click or Escape, same "dismiss on
  // anything else" behavior users expect from any popover/menu.
  useEffect(() => {
    if (!infoOpen) return;

    function handlePointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setInfoOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setInfoOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [infoOpen]);

  return (
    <div style={styles.wrap} ref={wrapRef}>
      <div style={styles.labelRow}>
        <label style={styles.label} htmlFor="subtype-select">
          Concept
        </label>
        <button
          type="button"
          style={styles.infoButton}
          aria-expanded={infoOpen}
          aria-label="What do these concepts mean?"
          onClick={() => setInfoOpen((open) => !open)}
        >
          ⓘ
        </button>
      </div>
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
      {infoOpen && (
        <div style={styles.popover} role="tooltip">
          {SUBTYPES.map((s, i) => (
            <div key={s.value}>
              {i > 0 && <hr style={styles.popoverDivider} />}
              <div style={styles.popoverItem}>
                <div style={styles.popoverItemLabel}>{s.label}</div>
                <div>{s.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
