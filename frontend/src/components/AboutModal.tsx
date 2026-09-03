import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { SUBSCORE_LABELS, SUBSCORE_DESCRIPTIONS, SUBSCORE_ORDER } from "./SubscoreChart";
import { SUBTYPES } from "./SubtypeSelector";
import { BAND_STYLES } from "./ScoreCard";
import type { Band } from "../api/scoreClient";

// Score ranges per band (docs/design.md 2.4). Not derived from BAND_STYLES
// since the backend only returns the band name, not its threshold, so this
// is the UI's own copy of the same ranges the backend applies.
const BAND_RANGES: Record<Band, string> = {
  strong: "80-100",
  good: "60-79",
  marginal: "40-59",
  weak: "0-39",
};

const BAND_ORDER: Band[] = ["strong", "good", "marginal", "weak"];

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(11, 11, 11, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 10,
  },
  dialog: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    background: "#fcfcfb",
    color: "#0b0b0b",
    borderRadius: 8,
    padding: 24,
    maxWidth: 560,
    width: "100%",
    maxHeight: "85vh",
    overflowY: "auto",
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    lineHeight: 1,
    color: "#52514e",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  title: {
    fontSize: 20,
    margin: "0 24px 12px 0",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    margin: "20px 0 8px",
  },
  body: {
    fontSize: 13,
    color: "#52514e",
    lineHeight: 1.5,
    margin: "0 0 8px",
  },
  itemLabel: {
    fontWeight: 600,
    fontSize: 13,
    margin: "0 0 2px",
  },
  itemDescription: {
    fontSize: 13,
    color: "#52514e",
    lineHeight: 1.5,
    margin: "0 0 12px",
  },
  bandRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: "0 0 6px",
    fontSize: 13,
  },
  bandDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  bandRange: {
    color: "#898781",
    fontVariantNumeric: "tabular-nums",
  },
  disclaimer: {
    fontSize: 13,
    lineHeight: 1.5,
    margin: "8px 0 8px",
    padding: 12,
    background: "#fdf3ec",
    border: "1px solid #ec835a",
    borderRadius: 6,
    color: "#0b0b0b",
  },
  link: {
    color: "#2a78d6",
  },
};

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Escape-to-close and focusing the close button on open match the
  // dismiss/focus conventions SubtypeSelector's popover already uses.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div
        style={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" style={styles.closeButton} aria-label="Close" onClick={onClose}>
          ✕
        </button>

        <h2 id="about-modal-title" style={styles.title}>
          About LocaleScore
        </h2>
        <p style={styles.body}>
          LocaleScore is a site-selection tool for restaurants in the Omaha, NE metro. Click a point on the map and
          get back a score (0-100) rating how well that location fits a given restaurant concept.
        </p>

        <h3 style={styles.sectionTitle}>How to use it</h3>
        <p style={styles.body}>
          Pick a concept from the "Concept" dropdown, then click a point on the map. LocaleScore draws that
          concept's trade area (an isochrone showing travel time on foot or by car) around the point and scores it.
        </p>

        <h3 style={styles.sectionTitle}>Concepts</h3>
        {SUBTYPES.map((s) => (
          <div key={s.value}>
            <p style={styles.itemLabel}>{s.label}</p>
            <p style={styles.itemDescription}>{s.description}</p>
          </div>
        ))}

        <h3 style={styles.sectionTitle}>Sub-scores</h3>
        <p style={styles.body}>
          The overall score is a weighted combination of five sub-scores, each scored 0-100 (hover a sub-score's row
          on the score card for the same descriptions):
        </p>
        {SUBSCORE_ORDER.map((key) => (
          <div key={key}>
            <p style={styles.itemLabel}>{SUBSCORE_LABELS[key]}</p>
            <p style={styles.itemDescription}>{SUBSCORE_DESCRIPTIONS[key]}</p>
          </div>
        ))}

        <h3 style={styles.sectionTitle}>Overall score</h3>
        <p style={styles.body}>The weighted result is shown as one of four bands:</p>
        {BAND_ORDER.map((band) => (
          <p key={band} style={styles.bandRow}>
            <span style={{ ...styles.bandDot, background: BAND_STYLES[band].color }} />
            <strong>{BAND_STYLES[band].label}</strong>
            <span style={styles.bandRange}>{BAND_RANGES[band]}</span>
          </p>
        ))}

        <h3 style={styles.sectionTitle}>Proof-of-concept</h3>
        <p style={styles.disclaimer}>
          This is a proof-of-concept, not a real product, built entirely on free data sources (Census ACS/TIGER,
          Overture Places, OpenStreetMap, OpenRouteService). The scoring methodology is a reasonable-sounding
          heuristic, not a professionally validated model, and it's limited to the Omaha metro. Treat the output as
          illustrative, not business guidance.
        </p>

        <p style={styles.body}>
          <a href="https://github.com/kharmon11/localescore" target="_blank" rel="noopener noreferrer" style={styles.link}>
            View the source on GitHub ↗
          </a>
        </p>
      </div>
    </div>
  );
}
