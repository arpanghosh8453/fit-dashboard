import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { RecordPoint } from "../types";
import type { MapStyle } from "../stores/settingsStore";
import { useSettingsStore } from "../stores/settingsStore";

type Props = {
  records: RecordPoint[];
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
};

type BaseMapInfo = { label: string; tileUrl: string; attribution: string };

const BASEMAPS: Record<"light" | "dark" | "openstreet" | "topo" | "satellite", BaseMapInfo> = {
  light: {
    label: "Light",
    tileUrl: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors (c) CARTO",
  },
  openstreet: {
    label: "OpenStreet",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors",
  },
  topo: {
    label: "Topo",
    tileUrl: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors, SRTM | OpenTopoMap",
  },
  satellite: {
    label: "Satellite",
    tileUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles (c) Esri, Maxar, Earthstar Geographics",
  },
  dark: {
    label: "Dark",
    tileUrl: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors (c) CARTO",
  },
};

function styleFromMap(ms: MapStyle, theme: "light" | "dark"): StyleSpecification {
  const actualStyle = ms === "default" ? theme : ms;
  const s = BASEMAPS[actualStyle as keyof typeof BASEMAPS];
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [s.tileUrl],
        tileSize: 256,
        attribution: s.attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

const HEAT_SOURCE_ID = "overview-heat-source";
const CLUSTER_SOURCE_ID = "overview-cluster-source";
const HEAT_LAYER_ID = "overview-heat-layer";
const CLUSTER_LAYER_ID = "overview-cluster-layer";
const CLUSTER_LABEL_LAYER_ID = "overview-cluster-label-layer";
const POINT_LAYER_ID = "overview-point-layer";

export function OverviewLocationMap({ records, mapStyle, setMapStyle }: Props) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const theme = useSettingsStore((s) => s.theme);

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = records
      .filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number")
      .map((r) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [r.longitude as number, r.latitude as number],
        },
        properties: {},
      }));
    return { type: "FeatureCollection", features };
  }, [records]);

  function fitToData(map: maplibregl.Map) {
    if (!geojson.features.length) return;
    const first = geojson.features[0].geometry.coordinates;
    const bounds = geojson.features.reduce(
      (b, f) => b.extend(f.geometry.coordinates as [number, number]),
      new maplibregl.LngLatBounds(first as [number, number], first as [number, number])
    );
    map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 650 });
  }

  function ensureSourcesAndLayers(map: maplibregl.Map) {
    const heatSrc = map.getSource(HEAT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const clusterSrc = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

    if (heatSrc) {
      heatSrc.setData(geojson);
    } else {
      map.addSource(HEAT_SOURCE_ID, { type: "geojson", data: geojson });
    }

    if (clusterSrc) {
      clusterSrc.setData(geojson);
    } else {
      map.addSource(CLUSTER_SOURCE_ID, {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 11,
      });
    }

    if (!map.getLayer(HEAT_LAYER_ID)) {
      map.addLayer({
        id: HEAT_LAYER_ID,
        type: "heatmap",
        source: HEAT_SOURCE_ID,
        maxzoom: 11,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.7, 11, 1.6],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.2,
            "rgba(74, 222, 128, 0.35)",
            0.45,
            "rgba(132, 204, 22, 0.55)",
            0.7,
            "rgba(250, 204, 21, 0.7)",
            1,
            "rgba(239, 68, 68, 0.85)",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 11, 26],
          "heatmap-opacity": 0.95,
        },
      });
    }

    if (!map.getLayer(CLUSTER_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: CLUSTER_SOURCE_ID,
        maxzoom: 11,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#22d3ee",
            25,
            "#facc15",
            80,
            "#ef4444",
          ],
          "circle-radius": ["step", ["get", "point_count"], 12, 25, 16, 80, 22],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.65)",
        },
      });
    }

    if (!map.getLayer(CLUSTER_LABEL_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_LABEL_LAYER_ID,
        type: "symbol",
        source: CLUSTER_SOURCE_ID,
        maxzoom: 11,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["Open Sans Bold"],
        },
        paint: {
          "text-color": "#ffffff",
        },
      });
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: CLUSTER_SOURCE_ID,
        minzoom: 10,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 6],
          "circle-color": "#34d399",
          "circle-opacity": 0.35,
        },
      });
    }
  }

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleFromMap(mapStyle, theme),
      center: [0, 0],
      zoom: 2,
      minZoom: 2,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      ensureSourcesAndLayers(map);
      fitToData(map);
    });

    map.on("click", CLUSTER_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id;
      const source = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source || clusterId == null) return;
      void source.getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom, duration: 450 });
        })
        .catch(() => {
          // Ignore expansion errors for stale cluster ids.
        });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.setStyle(styleFromMap(mapStyle, theme));
    const onIdle = () => {
      map.off("idle", onIdle);
      ensureSourcesAndLayers(map);
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
      ensureSourcesAndLayers(map);
    } else {
      const onIdle = () => {
        map.off("idle", onIdle);
        ensureSourcesAndLayers(map);
      };
      map.on("idle", onIdle);
      return () => {
        map.off("idle", onIdle);
      };
    }
  }, [geojson]);

  return (
    <div className="panel">
      <div className="map-header" style={{ marginBottom: "0.6rem" }}>
        <div>
          <h3>Explored Locations</h3>
          <p className="panel-subtitle">GPS density heatmap with auto-clustering at low zoom levels</p>
        </div>
        <div className="map-controls">
          <label className="map-control">
            <span className="small">Style</span>
            <select value={mapStyle} onChange={(e) => setMapStyle(e.target.value as MapStyle)}>
              <option value="default">Default</option>
              <option value="openstreet">OpenStreet</option>
              <option value="topo">Topo</option>
              <option value="satellite">Satellite</option>
            </select>
          </label>
        </div>
      </div>

      <div className="overview-map-canvas" ref={mapContainerRef} />

      <div className="map-footer-actions">
        <button className="btn-outline-secondary" onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          fitToData(map);
        }}>
          Reset zoom
        </button>
      </div>
    </div>
  );
}
