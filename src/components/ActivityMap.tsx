import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { RecordPoint } from "../types";
import type { MapStyle } from "../stores/settingsStore";
import { useSettingsStore } from "../stores/settingsStore";

type Props = {
  records: RecordPoint[];
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
};

type PathColorMode = "solid" | "speed" | "heart_rate" | "cadence" | "altitude" | "power" | "temperature" | "time";

const PATH_COLOR_OPTIONS: { value: PathColorMode; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "speed", label: "Speed" },
  { value: "heart_rate", label: "Heart Rate" },
  { value: "cadence", label: "Cadence" },
  { value: "altitude", label: "Altitude" },
  { value: "power", label: "Power" },
  { value: "temperature", label: "Temperature" },
  { value: "time", label: "Time (Start \u2192 End)" },
];

type BaseMapInfo = { label: string; tileUrl: string; attribution: string };

const BASEMAPS: Record<"light" | "dark" | "openstreet" | "topo" | "satellite", BaseMapInfo> = {
  light: {
    label: "Light",
    tileUrl: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  },
  openstreet: {
    label: "OpenStreet",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenStreetMap contributors"
  },
  topo: {
    label: "Topo",
    tileUrl: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenStreetMap contributors, SRTM | OpenTopoMap"
  },
  satellite: {
    label: "Satellite",
    tileUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles \u00a9 Esri, Maxar, Earthstar Geographics"
  },
  dark: {
    label: "Dark",
    tileUrl: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenStreetMap contributors \u00a9 CARTO"
  }
};

function styleFromMap(ms: MapStyle, theme: "light" | "dark"): StyleSpecification {
  const actualStyle = ms === "default" ? theme : ms;
  const s = BASEMAPS[actualStyle as keyof typeof BASEMAPS];
  return {
    version: 8,
    sources: { basemap: { type: "raster", tiles: [s.tileUrl], tileSize: 256, attribution: s.attribution } },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }]
  };
}

/* ── Color scale ─────────────────────────────────────────────────── */

function valueToColor(t: number): string {
  const stops: [number, number, number][] = [
    [0, 100, 200], [0, 185, 225], [16, 185, 129], [250, 170, 30], [240, 70, 70],
  ];
  const s = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const lo = Math.max(0, Math.min(Math.floor(s), stops.length - 2));
  const hi = lo + 1;
  const f = s - lo;
  return `rgb(${Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f)},${Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f)},${Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f)})`;
}

function getMetricValues(recs: RecordPoint[], mode: PathColorMode): number[] {
  switch (mode) {
    case "speed": return recs.map((r) => (r.speed_m_s ?? 0) * 3.6);
    case "heart_rate": return recs.map((r) => r.heart_rate ?? 0);
    case "cadence": return recs.map((r) => r.cadence ?? 0);
    case "altitude": return recs.map((r) => r.altitude_m ?? 0);
    case "power": return recs.map((r) => r.power ?? 0);
    case "temperature": return recs.map((r) => r.temperature_c ?? 0);
    case "time": return recs.map((_, i) => i);
    default: return recs.map(() => 0);
  }
}

function buildColoredGeoJson(
  gpsRecs: RecordPoint[],
  coords: number[][],
  mode: PathColorMode
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  if (coords.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  // Use a single continuous LineString for solid paths to avoid
  // segment overlapping artifacts (disconnections/beading).
  if (mode === "solid") {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { color: "#f0c24a" }
        }
      ]
    };
  }

  let values: number[] | null = null;
  let min = 0, max = 1, range = 1;

  values = getMetricValues(gpsRecs, mode);
  min = Infinity; max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  range = (max - min) || 1;

  const features: GeoJSON.Feature<GeoJSON.Geometry>[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const color = valueToColor((values![i] - min) / range);
    const r = gpsRecs[i];
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [coords[i], coords[i + 1]] },
      properties: {
        color,
        speed_kmh: r.speed_m_s != null ? Math.round(r.speed_m_s * 36) / 10 : 0,
        heart_rate: r.heart_rate ?? 0,
        altitude_m: r.altitude_m != null ? Math.round(r.altitude_m) : 0,
        cadence: r.cadence ?? 0,
        power_w: r.power ?? 0,
        temp_c: r.temperature_c != null ? Math.round(r.temperature_c * 10) / 10 : 0,
      }
    });
  }
  return { type: "FeatureCollection", features };
}

/* ── Tooltip builder ─────────────────────────────────────────────── */

function buildTooltipHtml(props: Record<string, any>): string {
  const rows: string[] = [];
  if (Number(props.speed_kmh) > 0)
    rows.push(`<div class="tt-row"><span>Speed</span><strong>${props.speed_kmh} km/h</strong></div>`);
  if (Number(props.heart_rate) > 0)
    rows.push(`<div class="tt-row"><span>HR</span><strong>${props.heart_rate} bpm</strong></div>`);
  if (Number(props.altitude_m) > 0)
    rows.push(`<div class="tt-row"><span>Altitude</span><strong>${props.altitude_m} m</strong></div>`);
  if (Number(props.cadence) > 0)
    rows.push(`<div class="tt-row"><span>Cadence</span><strong>${props.cadence} rpm</strong></div>`);
  if (Number(props.power_w) > 0)
    rows.push(`<div class="tt-row"><span>Power</span><strong>${props.power_w} W</strong></div>`);
  if (Number(props.temp_c) !== 0)
    rows.push(`<div class="tt-row"><span>Temp</span><strong>${props.temp_c} \u00b0C</strong></div>`);
  if (rows.length === 0) return `<div class="map-tooltip"><em style="color:var(--text-muted)">No data at this point</em></div>`;
  return `<div class="map-tooltip">${rows.join("")}</div>`;
}

/* ── Component ───────────────────────────────────────────────────── */

const SOURCE_ID = "activity-route";
const LAYER_ID = "activity-route-layer";
const HIT_LAYER_ID = "activity-route-hit";

export function ActivityMap({ records, mapStyle, setMapStyle }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const theme = useSettingsStore((s) => s.theme);

  const [pathColorMode, setPathColorMode] = useState<PathColorMode>("solid");
  const pathColorModeRef = useRef(pathColorMode);

  const gpsRecords = useMemo(
    () => records
      .filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number")
      .slice(0, 6000),
    [records]
  );

  const coordinates = useMemo(
    () => gpsRecords.map((r) => [r.longitude as number, r.latitude as number]),
    [gpsRecords]
  );

  const gpsRecordsRef = useRef(gpsRecords);
  const coordinatesRef = useRef(coordinates);

  useEffect(() => { coordinatesRef.current = coordinates; }, [coordinates]);
  useEffect(() => { gpsRecordsRef.current = gpsRecords; }, [gpsRecords]);
  useEffect(() => { pathColorModeRef.current = pathColorMode; }, [pathColorMode]);

  /* ── Draw route ─────────────────────────────────────────────── */

  function drawRoute(map: maplibregl.Map, fitToRoute: boolean) {
    const coords = coordinatesRef.current;
    const gpsRecs = gpsRecordsRef.current;
    const mode = pathColorModeRef.current;

    if (!coords.length) {
      if (map.getLayer(HIT_LAYER_ID)) map.removeLayer(HIT_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      return;
    }

    const geojson = buildColoredGeoJson(gpsRecs, coords, mode);
    const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

    if (existing) {
      existing.setData(geojson);
    } else {
      map.addSource(SOURCE_ID, { type: "geojson", data: geojson });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 4,
          "line-color": ["get", "color"] as any,
          "line-opacity": 1.0
        }
      });
    } else {
      map.setPaintProperty(LAYER_ID, "line-color", ["get", "color"]);
    }

    // Invisible wider hit-area layer for easier hover detection
    if (!map.getLayer(HIT_LAYER_ID)) {
      map.addLayer({
        id: HIT_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 20,
          "line-color": "rgba(0,0,0,0)",
          "line-opacity": 0
        }
      });
    }

    if (fitToRoute) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
      );
      map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 550 });
    }
  }

  /* ── Map lifecycle ──────────────────────────────────────────── */

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleFromMap(mapStyle, theme),
      center: [0, 0],
      zoom: 2,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      drawRoute(map, true);
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    // Hover tooltip popup
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "220px" });
    popupRef.current = popup;

    map.on("mousemove", HIT_LAYER_ID, (e) => {
      if (!e.features?.[0]) return;
      map.getCanvas().style.cursor = "crosshair";
      const props = e.features[0].properties as Record<string, any>;
      popup.setLngLat(e.lngLat).setHTML(buildTooltipHtml(props)).addTo(map);
    });

    map.on("mouseleave", HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // setStyle() destroys existing sources/layers AND may clear pending
    // event listeners. We must call setStyle first, then wait for the
    // map to become idle (all tiles loaded, no pending work) before
    // re-adding our route overlay.
    map.setStyle(styleFromMap(mapStyle, theme));

    const onIdle = () => {
      map.off("idle", onIdle);
      drawRoute(map, false);
    };
    map.on("idle", onIdle);

    return () => {
      map.off("idle", onIdle);
    };
  }, [mapStyle, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      drawRoute(map, true);
    } else {
      const onIdle = () => { map.off("idle", onIdle); drawRoute(map, true); };
      map.on("idle", onIdle);
      return () => { map.off("idle", onIdle); };
    }
  }, [coordinates]);

  // Redraw when color mode changes (don't re-fit)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      drawRoute(map, false);
    } else {
      const onIdle = () => { map.off("idle", onIdle); drawRoute(map, false); };
      map.on("idle", onIdle);
      return () => { map.off("idle", onIdle); };
    }
  }, [pathColorMode]);

  return (
    <section className="panel map-panel">
      <div className="map-header">
        <h3>GPS Route</h3>
        <div className="map-controls">
          <div className="map-control">
            <span>Style</span>
            <select value={mapStyle} onChange={(e) => setMapStyle(e.target.value as MapStyle)}>
              {Object.entries(BASEMAPS).map(([value, info]) => (
                <option key={value} value={value}>{info.label}</option>
              ))}
            </select>
          </div>
          <div className="map-control">
            <span>Color</span>
            <select value={pathColorMode} onChange={(e) => setPathColorMode(e.target.value as PathColorMode)}>
              {PATH_COLOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div ref={mapContainerRef} className="map-canvas" />

      {pathColorMode !== "solid" && coordinates.length > 0 && (
        <div className="color-legend">
          <div className="color-gradient-bar" />
          <div className="color-labels">
            <span>Low</span>
            <span>{PATH_COLOR_OPTIONS.find((o) => o.value === pathColorMode)?.label ?? ""}</span>
            <span>High</span>
          </div>
        </div>
      )}

      {!coordinates.length && (
        <p className="small" style={{ textAlign: "center", padding: "0.5rem 0" }}>
          No GPS coordinates found in this activity.
        </p>
      )}
    </section>
  );
}
