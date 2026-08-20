import { useState, useCallback } from "react";
import MapView from "./components/MapView.jsx";
import SubtypeSelector from "./components/SubtypeSelector.jsx";
import ScoreCard from "./components/ScoreCard.jsx";
import { fetchScore } from "./api/scoreClient.js";

export default function App() {
  const [subtype, setSubtype] = useState("coffee_shop");
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePointSelected = useCallback(
    async ({ lat, lng }) => {
      setSelectedPoint({ lat, lng });
      setLoading(true);
      setError(null);
      try {
        const data = await fetchScore({ lat, lng, subtype });
        setResult(data);
      } catch (err) {
        setError(err.message);
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [subtype]
  );

  return (
    <div style={styles.layout}>
      <div style={styles.mapPane}>
        <MapView
          subtype={subtype}
          onPointSelected={handlePointSelected}
          isochroneGeoJSON={result?.isochrone}
          selectedPoint={selectedPoint}
        />
      </div>
      <aside style={styles.sidebar}>
        <h1 style={styles.title}>Omaha Restaurant Site Score</h1>
        <p style={styles.subtitle}>Douglas &amp; Sarpy counties, NE. Click the map to score a point.</p>
        <SubtypeSelector value={subtype} onChange={setSubtype} />
        {loading && <p style={styles.status}>Scoring…</p>}
        {error && <p style={styles.error}>{error}</p>}
        {!loading && <ScoreCard result={result} />}
      </aside>
    </div>
  );
}

const styles = {
  layout: {
    display: "grid",
    gridTemplateColumns: "1fr 380px",
    height: "100vh",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  mapPane: {
    position: "relative",
  },
  sidebar: {
    padding: 20,
    overflowY: "auto",
    borderLeft: "1px solid #e1e0d9",
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
  status: {
    fontSize: 13,
    color: "#52514e",
  },
  error: {
    fontSize: 13,
    color: "#d03b3b",
  },
};
