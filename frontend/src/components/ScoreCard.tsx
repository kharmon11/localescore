import type { CSSProperties } from "react";
import SubscoreChart from "./SubscoreChart";
import type { ScoreResponse, Band, ScoreErrorType } from "../api/scoreClient";

// The four score bands (docs/design.md 2.4) are a quality/severity scale, so
// they're mapped onto the dataviz skill's fixed status palette rather than
// an arbitrary color choice. Because "warning" and "serious" sit below 3:1
// contrast on a light surface by design, every badge pairs the color with a
// visible text label, never color alone.
//
// Typed as Record<Band, ...> so a missing or mistyped band is a compile
// error here, the same reasoning as SubscoreChart's SUBSCORE_LABELS.
const BAND_STYLES: Record<Band, { color: string; label: string }> = {
  strong: { color: "#0ca30c", label: "Strong site" },
  good: { color: "#fab219", label: "Good site" },
  marginal: { color: "#ec835a", label: "Marginal site" },
  weak: { color: "#d03b3b", label: "Weak site" },
};

const styles: Record<string, CSSProperties> = {
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
  status: {
    fontSize: 13,
    color: "#52514e",
    margin: 0,
  },
  error: {
    fontSize: 13,
    color: "#d03b3b",
    margin: 0,
  },
  retryButton: {
    marginTop: 8,
    padding: "4px 10px",
    fontSize: 13,
    fontWeight: 600,
    color: "#2a78d6",
    background: "#fff",
    border: "1px solid #2a78d6",
    borderRadius: 6,
    cursor: "pointer",
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

// App.jsx constructs this as a plain object from a caught error
// ({ message: err.message, type: err.type, resetAt: err.resetAt }), not a
// real ScoreError instance, so this is its own plain shape rather than
// importing the ScoreError class type.
export interface ScoreCardErrorInfo {
  message: string;
  type?: ScoreErrorType;
  resetAt?: string | null;
}

// For a quota_exceeded error with a valid resetAt, build a message with the
// actual time (and date, if it's not today) the user can try again,
// computed in the browser's own local timezone, since the backend (running
// on Cloud Run) can't know the viewer's timezone. Falls back to the
// backend's own message for every other error, or if resetAt is missing.
function formatErrorMessage(error: ScoreCardErrorInfo): string {
  if (error.type === "quota_exceeded" && error.resetAt) {
    const resetDate = new Date(error.resetAt);
    if (!Number.isNaN(resetDate.getTime())) {
      const now = new Date();
      const time = resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (resetDate.toDateString() === now.toDateString()) {
        return `Openrouteservice data is temporarily unavailable. You can try again at ${time}.`;
      }
      const date = resetDate.toLocaleDateString([], { month: "short", day: "numeric" });
      return `Openrouteservice data is temporarily unavailable. You can try again at ${time} on ${date}.`;
    }
  }
  return error.message;
}

interface CardContentProps {
  result: ScoreResponse | null;
  error: ScoreCardErrorInfo | null;
  loading: boolean;
  onRetry: () => void;
}

function cardContent({ result, error, loading, onRetry }: CardContentProps) {
  if (loading) {
    return <p style={styles.status}>Scoring…</p>;
  }

  if (error) {
    return (
      <>
        <p style={styles.error}>{formatErrorMessage(error)}</p>
        {error.type === "transient" && (
          <button type="button" style={styles.retryButton} onClick={onRetry}>
            Try again
          </button>
        )}
      </>
    );
  }

  if (!result) {
    return <p style={styles.placeholder}>Click a point on the map to score it.</p>;
  }

  const band = BAND_STYLES[result.band] ?? BAND_STYLES.marginal;

  return (
    <>
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
    </>
  );
}

export default function ScoreCard({ result, error, loading, onRetry }: CardContentProps) {
  return <div style={styles.card}>{cardContent({ result, error, loading, onRetry })}</div>;
}
