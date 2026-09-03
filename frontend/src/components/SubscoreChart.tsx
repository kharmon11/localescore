import { useState } from "react";
import type { ScoreSubscores } from "../api/scoreClient";

/**
 * Horizontal bar chart for the five sub-scores returned by POST /score.
 *
 * Chart-type choice (per the project's dataviz skill): the sub-scores are
 * five *named, nominal* dimensions of magnitude for a single candidate site,
 * not distinct series to tell apart and not a polarity, so this is a
 * "compare magnitude" job. That maps to a bar chart with one sequential hue,
 * NOT a radar/spider chart (radar charts distort area and make magnitude
 * harder to compare accurately) and NOT one color per bar (nominal
 * categories don't get colored by their own value: that spends the
 * identity channel re-encoding what the bar length already shows).
 */

// Typed against ScoreSubscores so a mismatch (a renamed or added sub-score)
// is a compile error here, not a silently-missing row.
const SUBSCORE_LABELS: Record<keyof ScoreSubscores, string> = {
  demandDensity: "Demand density",
  competitiveSaturation: "Competitive saturation",
  complementaryDraw: "Complementary draw",
  accessibilityVisibility: "Accessibility & visibility",
  growthTrend: "Growth trend",
};

const SUBSCORE_ORDER: (keyof ScoreSubscores)[] = [
  "demandDensity",
  "competitiveSaturation",
  "complementaryDraw",
  "accessibilityVisibility",
  "growthTrend",
];

interface SubscoreChartProps {
  subscores?: ScoreSubscores;
  notes?: Partial<Record<keyof ScoreSubscores, string>>;
}

export default function SubscoreChart({ subscores, notes }: SubscoreChartProps) {
  const [hovered, setHovered] = useState<keyof ScoreSubscores | null>(null);

  return (
    <div className="viz-root subscore-chart">
      <style>{`
        .subscore-chart {
          color-scheme: light;
          --surface-1: #fcfcfb;
          --text-primary: #0b0b0b;
          --text-secondary: #52514e;
          --text-muted: #898781;
          --gridline: #e1e0d9;
          --series-1: #2a78d6;
          --series-1-hover: #1c5cab;
        }
        .subscore-chart {
          background: var(--surface-1);
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          padding: 4px 0;
        }
        .subscore-row {
          display: grid;
          grid-template-columns: 160px 1fr 36px;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          position: relative;
        }
        .subscore-label {
          color: var(--text-secondary);
          font-size: 13px;
        }
        .subscore-track {
          position: relative;
          height: 24px;
          border-bottom: 1px solid var(--gridline);
        }
        .subscore-bar {
          height: 16px;
          margin-top: 4px;
          border-radius: 4px;
          background: var(--series-1);
          transition: background 120ms ease;
        }
        .subscore-row:hover .subscore-bar,
        .subscore-row:focus-within .subscore-bar {
          background: var(--series-1-hover);
        }
        .subscore-value {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 600;
          text-align: right;
        }
        .subscore-tooltip {
          position: absolute;
          left: 0;
          top: -26px;
          background: var(--text-primary);
          color: var(--surface-1);
          font-size: 12px;
          padding: 3px 8px;
          border-radius: 4px;
          pointer-events: none;
          white-space: nowrap;
          z-index: 1;
        }
        .subscore-tooltip.has-note {
          left: auto;
          right: 0;
          top: auto;
          bottom: -8px;
          transform: translateY(100%);
          white-space: normal;
          width: 240px;
          line-height: 1.4;
        }
        .subscore-note-marker {
          color: var(--text-muted);
          font-size: 11px;
          margin-left: 3px;
        }
      `}</style>

      {SUBSCORE_ORDER.map((key) => {
        const value = subscores?.[key] ?? 0;
        const note = notes?.[key];
        return (
          <div
            key={key}
            className="subscore-row"
            tabIndex={0}
            onMouseEnter={() => setHovered(key)}
            onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
            onFocus={() => setHovered(key)}
            onBlur={() => setHovered((h) => (h === key ? null : h))}
          >
            <span className="subscore-label">
              {SUBSCORE_LABELS[key]}
              {note && (
                <span className="subscore-note-marker" title={note}>
                  ⓘ
                </span>
              )}
            </span>
            <div className="subscore-track">
              <div className="subscore-bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
              {hovered === key && (
                <div className={`subscore-tooltip${note ? " has-note" : ""}`}>
                  {SUBSCORE_LABELS[key]}: <strong>{value}</strong>
                  {note && <div>{note}</div>}
                </div>
              )}
            </div>
            <span className="subscore-value">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
