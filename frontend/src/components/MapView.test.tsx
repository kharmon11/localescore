import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-map-gl/mapbox", () => ({
  default: ({ children, onClick }: any) => (
    <div data-testid="mock-map" onClick={() => onClick({ lngLat: { lat: 41.5, lng: -96.5 } })}>
      {children}
    </div>
  ),
  Source: ({ children, id }: any) => <div data-testid={`mock-source-${id}`}>{children}</div>,
  Layer: (props: any) => <div data-testid={`mock-layer-${props.id}`} />,
  Marker: ({ latitude, longitude }: any) => (
    <div data-testid="mock-marker" data-lat={latitude} data-lng={longitude} />
  ),
}));

// MAPBOX_TOKEN is read from import.meta.env at module load time, so each
// scenario needs a fresh module instance loaded after stubbing the env var.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("shows a setup message when VITE_MAPBOX_TOKEN is not set", async () => {
  vi.stubEnv("VITE_MAPBOX_TOKEN", "");
  const { default: MapView } = await import("./MapView");
  render(<MapView subtype="coffee_shop" onPointSelected={() => {}} isochroneGeoJSON={null} selectedPoint={null} />);
  expect(screen.getByText(/Set VITE_MAPBOX_TOKEN/)).toBeInTheDocument();
});

test("clicking the map calls onPointSelected with lat/lng from the click event", async () => {
  vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");
  const { default: MapView } = await import("./MapView");
  const onPointSelected = vi.fn();
  render(
    <MapView subtype="coffee_shop" onPointSelected={onPointSelected} isochroneGeoJSON={null} selectedPoint={null} />
  );
  fireEvent.click(screen.getByTestId("mock-map"));
  expect(onPointSelected).toHaveBeenCalledWith({ lat: 41.5, lng: -96.5 });
});

test("renders the isochrone source only when isochroneGeoJSON is present", async () => {
  vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");
  const { default: MapView } = await import("./MapView");
  const { rerender } = render(
    <MapView subtype="coffee_shop" onPointSelected={() => {}} isochroneGeoJSON={null} selectedPoint={null} />
  );
  expect(screen.queryByTestId("mock-source-isochrone")).not.toBeInTheDocument();

  rerender(
    <MapView
      subtype="coffee_shop"
      onPointSelected={() => {}}
      isochroneGeoJSON={{ type: "FeatureCollection", features: [] }}
      selectedPoint={null}
    />
  );
  expect(screen.getByTestId("mock-source-isochrone")).toBeInTheDocument();
});

test("renders a marker only when selectedPoint is present", async () => {
  vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");
  const { default: MapView } = await import("./MapView");
  const { rerender } = render(
    <MapView subtype="coffee_shop" onPointSelected={() => {}} isochroneGeoJSON={null} selectedPoint={null} />
  );
  expect(screen.queryByTestId("mock-marker")).not.toBeInTheDocument();

  rerender(
    <MapView
      subtype="coffee_shop"
      onPointSelected={() => {}}
      isochroneGeoJSON={null}
      selectedPoint={{ lat: 41.3, lng: -95.9 }}
    />
  );
  const marker = screen.getByTestId("mock-marker");
  expect((marker as HTMLElement).dataset.lat).toBe("41.3");
  expect((marker as HTMLElement).dataset.lng).toBe("-95.9");
});
