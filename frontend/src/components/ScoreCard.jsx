import SubscoreChart from "./SubscoreChart.jsx";

// The four score bands (docs/design.md 2.4) are a quality/severity scale, so
// they're mapped onto the dataviz skill's fixed status palette rather than
// an arbitrary color choice. Because "warning" and "serious" sit below 3:1
// contrast on a light surface by design, every badge pairs the color with a
// visible text label -- never color alone.
const BAND_STYLES = {
  strong: { color: "#0ca30c", label: "Strong site" },
  good: { color: "#fab219", label: "Good site" },
  marginal: { color: "#ec835a", label: "Marginal site" },
  weak: { color: "#d03b3b", label: "Weak site" },
};

export default function ScoreCard({ result }) {
  if (!result) {
    return (
      <div style={styles.card}>
        <p style={styles.placeholder}>Click a point on the map to score it.</p>
      </div>
    );
  }

  const band = BAND_STYLES[result.band] ?? BAND_STYLES.marginal;

  return (
    <div style={styles.card}>
      <div style={styles.heroRow}>
        <span style={styles.hero}>{result.overall}</span>
        <span style={{ ...styles.badge, color: band.color, borderColor: band.color }}>
          <span style={{ ...styles.badgeDot, background: band.color }} />
          {band.label}
        </span>
      </div>
      {result.weightsOverridden && (
        <p style={styles.overrideNote}>Custom weights applied (not the saved profile).</p>
      )}
      <SubscoreChart subscores={result.subscores} notes={result.notes} />
    </div>
  );
}

const styles = {
  card: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    background: "#fcfcfb",
    border: "1px solid #e1e0d9",
    borderRadius: 8,
    padding: 16,
    minWidth: 320,
  },
  placeholder: {
    color: "#898781",
    fontSize: 14,
    margin: 0,
  },
  heroRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    marginBottom: 12,
  },
  hero: {
    fontSize: 48,
    fontWeight: 600,
    color: "#0b0b0b",
    lineHeight: 1,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    border: "1px solid",
    borderRadius: 999,
    padding: "3px 10px",
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  overrideNote: {
    fontSize: 12,
    color: "#898781",
    marginTop: -6,
    marginBottom: 10,
  },
};
