import { useCallback, useState } from "react";
import Map, { Source, Layer, Marker } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Roughly centers Douglas + Sarpy counties, NE (docs/design.md geographic scope).
const INITIAL_VIEW_STATE = {
  latitude: 41.2565,
  longitude: -95.9345,
  zoom: 10.5,
};

const isochroneFillLayer = {
  id: "isochrone-fill",
  type: "fill",
  paint: {
    // Data-driven by the ORS range `value` property (seconds): the smaller
    // (primary) ring reads darker/more opaque, the outer ring lighter --
    // same single hue throughout, since this is one measure (reachability),
    // not multiple categories.
    "fill-color": "#2a78d6",
    "fill-opacity": ["interpolate", ["linear"], ["get", "value"], 300, 0.35, 1200, 0.12],
  },
};

const isochroneLineLayer = {
  id: "isochrone-line",
  type: "line",
  paint: {
    "line-color": "#2a78d6",
    "line-width": 1.5,
  },
};

export default function MapView({ subtype, onPointSelected, isochroneGeoJSON, selectedPoint }) {
  const [cursor, setCursor] = useState("auto");

  const handleClick = useCallback(
    (event) => {
      const { lng, lat } = event.lngLat;
      onPointSelected({ lat, lng });
    },
    [onPointSelected]
  );

  if (!MAPBOX_TOKEN) {
    return (
      <div style={styles.missingToken}>
        Set VITE_MAPBOX_TOKEN in frontend/.env (copy from .env.example) to load the map.
      </div>
    );
  }

  return (
    <Map
      initialViewState={INITIAL_VIEW_STATE}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      mapboxAccessToken={MAPBOX_TOKEN}
      cursor={cursor}
      onMouseEnter={() => setCursor("crosshair")}
      onClick={handleClick}
    >
      {isochroneGeoJSON && (
        <Source id="isochrone" type="geojson" data={isochroneGeoJSON}>
          <Layer {...isochroneFillLayer} />
          <Layer {...isochroneLineLayer} />
        </Source>
      )}

      {selectedPoint && (
        <Marker latitude={selectedPoint.lat} longitude={selectedPoint.lng} color="#2a78d6" />
      )}
    </Map>
  );
}

const styles = {
  missingToken: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    padding: 24,
    textAlign: "center",
    color: "#898781",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 14,
  },
};
