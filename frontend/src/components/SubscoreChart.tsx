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

// Static methodology text, always shown in the tooltip regardless of
// per-request data (contrast with `notes`, which is backend-computed and
// only ever populated for growthTrend today; see routes/score.ts's
// growthTrendNote).
const SUBSCORE_DESCRIPTIONS: Record<keyof ScoreSubscores, string> = {
  demandDensity:
    "Estimates how many people live within the site's trade area, weighting the tighter primary ring (e.g. the 5- or 10-minute isochrone) more heavily than the wider secondary ring, using Census block-group population data intersected with the isochrone shape. That weighted population is then compared against a citywide sample of points across Douglas and Sarpy counties, and the score is the percentile it falls at: 75 means this site's trade-area population is higher than about 75% of sampled locations, not an absolute headcount.",
  competitiveSaturation:
    "Counts existing competitors of the same subtype within the site's full trade area, converts that to a rate per 1,000 residents, and compares it to the citywide median rate for that subtype. This is a penalty, not a percentile. A site with the same or fewer competitors per capita than the median scores near or above 100, and the score drops as the local rate climbs above the median, reaching 0 once it's roughly double the citywide median.",
  complementaryDraw:
    "Counts nearby businesses within a short walk (400m) that tend to generate foot traffic without competing directly, such as offices, grocery stores, gyms, schools, hotels, entertainment venues, and other cafes and bars, and sums them with weights reflecting how much each type tends to draw (offices and grocery score highest, other food/drink venues lowest). That weighted total is then compared against a citywide sample of points, and the score is this site's percentile in that distribution.",
  accessibilityVisibility:
    "Combines two signals: the classification of the nearest road (major arterial roads score highest, quiet residential streets and footpaths score lowest, based on official road-class data), weighted 75%, and the number of transit stops, train or bus stations, within a short walk, weighted 25%. Unlike the other four sub-scores, this one isn't ranked against other points citywide. It's an absolute 0 to 100 score based only on this site's own surroundings.",
  growthTrend:
    "Compares the trade area's population across two Census 5-year estimate periods (the most recent available vs. roughly five years prior) to estimate whether the area is gaining or losing population, then ranks that growth rate against a citywide sample of points. This is an approximate multi-year trend, not a true year-over-year rate, since Census block groups don't get 1-year estimates.",
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
          right: 0;
          top: auto;
          bottom: -8px;
          transform: translateY(100%);
          background: var(--text-primary);
          color: var(--surface-1);
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 4px;
          pointer-events: none;
          white-space: normal;
          width: 300px;
          line-height: 1.4;
          z-index: 1;
        }
        .subscore-tooltip-note {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.25);
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
              <span className="subscore-note-marker">ⓘ</span>
            </span>
            <div className="subscore-track">
              <div className="subscore-bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
              {hovered === key && (
                <div className="subscore-tooltip">
                  {SUBSCORE_LABELS[key]}: <strong>{value}</strong>
                  <div>{SUBSCORE_DESCRIPTIONS[key]}</div>
                  {note && <div className="subscore-tooltip-note">{note}</div>}
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
