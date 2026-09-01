import { useState, useCallback, useRef } from "react";
import MapView from "./components/MapView.jsx";
import SubtypeSelector from "./components/SubtypeSelector.jsx";
import ScoreCard from "./components/ScoreCard.jsx";
import { fetchScore } from "./api/scoreClient.js";

const styles = {
  layout: {
    display: "grid",
    height: "100vh",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  mapPane: {
    position: "relative",
  },
  sidebar: {
    padding: 20,
    overflowY: "auto",
    background: "#f9f9f7",
  },
  title: {
    fontSize: 18,
    margin: "0 0 4px",
    color: "#0b0b0b",
  },
  subtitle: {
    fontSize: 13,
    color: "#898781",
    margin: "0 0 16px",
  },
};

export default function App() {
  const [subtype, setSubtype] = useState("coffee_shop");
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef({ id: 0, controller: null });

  const handlePointSelected = useCallback(
    async ({ lat, lng }) => {
      requestRef.current.controller?.abort();
      const requestId = ++requestRef.current.id;
      const controller = new AbortController();
      requestRef.current.controller = controller;

      setSelectedPoint({ lat, lng });
      setLoading(true);
      setError(null);
      try {
        const data = await fetchScore({ lat, lng, subtype }, controller.signal);
        if (requestRef.current.id !== requestId) return;
        setResult(data);
      } catch (err) {
        if (err.name === "AbortError" || requestRef.current.id !== requestId) return;
        setError({ message: err.message, type: err.type, resetAt: err.resetAt });
        setResult(null);
      } finally {
        if (requestRef.current.id === requestId) setLoading(false);
      }
    },
    [subtype]
  );

  return (
    <div className="app-layout" style={styles.layout}>
      {/* grid-template-columns/rows and the sidebar's border live here, not in
          the inline `styles` objects below -- an inline `style` prop always
          wins over any stylesheet rule for the same property, media query or
          not, so the responsive override couldn't take effect otherwise. */}
      <style>{`
        .app-layout {
          grid-template-columns: 1fr 380px;
        }
        .app-sidebar {
          border-left: 1px solid #e1e0d9;
        }
        @media (max-width: 768px) {
          .app-layout {
            grid-template-columns: 1fr;
            grid-template-rows: 45vh 1fr;
          }
          .app-sidebar {
            border-left: none;
            border-top: 1px solid #e1e0d9;
          }
        }
      `}</style>
      <div style={styles.mapPane}>
        <MapView
          subtype={subtype}
          onPointSelected={handlePointSelected}
          isochroneGeoJSON={result?.isochrone}
          selectedPoint={selectedPoint}
        />
      </div>
      <aside className="app-sidebar" style={styles.sidebar}>
        <h1 style={styles.title}>Omaha Restaurant Site Score</h1>
        <p style={styles.subtitle}>Douglas &amp; Sarpy counties, NE. Click the map to score a point.</p>
        <SubtypeSelector value={subtype} onChange={setSubtype} />
        <ScoreCard
          result={result}
          error={error}
          loading={loading}
          onRetry={() => handlePointSelected(selectedPoint)}
        />
      </aside>
    </div>
  );
}
