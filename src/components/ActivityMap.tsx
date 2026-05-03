import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { RecordPoint } from "../types";
import type { MapStyle } from "../stores/settingsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { convertElevationMeters, convertSpeedKmh, elevationLabel, speedLabel } from "../lib/units";
import { useTranslation } from "../lib/i18n";

type Props = {
  records: RecordPoint[];
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
  lapTimestampsUtc?: string[];
};

type PathColorMode = "solid" | "speed" | "heart_rate" | "cadence" | "altitude" | "power" | "temperature" | "time";
const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16, 32] as const;

const IconPlay = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="6 3 20 12 6 21 6 3" />
  </svg>
);

const IconPause = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const PATH_COLOR_VALUES: PathColorMode[] = [
  "solid", "speed", "heart_rate", "cadence", "altitude", "power", "temperature", "time",
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
  mode: PathColorMode,
  solidColor: string
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  if (coords.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  let values: number[] | null = null;
  let min = 0, max = 1, range = 1;

  if (mode !== "solid") {
    values = getMetricValues(gpsRecs, mode);
    min = Infinity; max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    range = (max - min) || 1;
  }

  const firstTsMs = gpsRecs.find((r) => Number.isFinite(r.timestamp_ms))?.timestamp_ms ?? 0;

  const features: GeoJSON.Feature<GeoJSON.Geometry>[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const color = mode === "solid" ? solidColor : valueToColor((values![i] - min) / range);
    const r = gpsRecs[i];
    const elapsedSeconds = Number.isFinite(r.timestamp_ms)
      ? Math.max(0, Math.round((r.timestamp_ms - firstTsMs) / 1000))
      : null;
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
        temp_c: r.temperature_c != null ? Math.round(r.temperature_c * 10) / 10 : null,
        elapsed_s: elapsedSeconds,
      }
    });
  }
  return { type: "FeatureCollection", features };
}

function buildSolidDisplayGeoJson(
  coords: number[][],
  solidColor: string
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  if (coords.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { color: solidColor }
    }]
  };
}

function buildGradientExpression(
  gpsRecs: RecordPoint[],
  mode: PathColorMode,
  fallbackColor: string
): any[] {
  if (mode === "solid" || gpsRecs.length < 2) {
    return ["interpolate", ["linear"], ["line-progress"], 0, fallbackColor, 1, fallbackColor];
  }

  const values = getMetricValues(gpsRecs, mode);
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = (max - min) || 1;

  const maxStops = 220;
  const stride = Math.max(1, Math.floor(values.length / maxStops));
  const expr: any[] = ["interpolate", ["linear"], ["line-progress"]];

  let lastProgress = -1;
  for (let i = 0; i < values.length; i += stride) {
    const progress = Math.max(0, Math.min(1, i / Math.max(1, values.length - 1)));
    if (progress <= lastProgress) continue;
    const color = valueToColor((values[i] - min) / range);
    expr.push(progress, color);
    lastProgress = progress;
  }

  // Ensure final stop exists at 1.0 without duplicate stop positions.
  const lastColor = valueToColor((values[values.length - 1] - min) / range);
  if (lastProgress < 1) {
    expr.push(1, lastColor);
    lastProgress = 1;
  }

  // Minimum valid interpolate expression requires at least two stops.
  if (expr.length <= 7) {
    return ["interpolate", ["linear"], ["line-progress"], 0, fallbackColor, 1, lastColor];
  }

  return expr;
}

function buildMarkerGeoJson(coords: number[][]): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  if (coords.length === 0) return { type: "FeatureCollection", features: [] };
  const start = coords[0];
  const end = coords[coords.length - 1];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: start },
        properties: { label: "S", color: "#22c55e" }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: end },
        properties: { label: "E", color: "#ef4444" }
      }
    ]
  };
}

/* ── Tooltip builder ─────────────────────────────────────────────── */

function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildTooltipHtml(props: Record<string, any>, distanceUnit: "km" | "mi"): string {
  const asFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const speed = asFiniteNumber(props.speed_kmh);
  const heartRate = asFiniteNumber(props.heart_rate);
  const altitude = asFiniteNumber(props.altitude_m);
  const cadence = asFiniteNumber(props.cadence);
  const power = asFiniteNumber(props.power_w);
  const temp = asFiniteNumber(props.temp_c);
  const elapsed = asFiniteNumber(props.elapsed_s);

  const fmt2 = (value: number): string => {
    return value.toFixed(2);
  };

  const iconSvg = (kind: "speed" | "heart" | "elevation" | "cadence" | "power" | "temp" | "duration") => {
    const common = `class="tt-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
    switch (kind) {
      case "speed":
        return `<svg ${common}><path d="M12 12m-10 0a10 10 0 1 0 20 0"/><path d="M12 12l4-4"/><circle cx="12" cy="12" r="1"/></svg>`;
      case "heart":
        return `<svg ${common}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
      case "elevation":
        return `<svg ${common}><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`;
      case "cadence":
        return `<svg ${common}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`;
      case "power":
        return `<svg ${common}><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`;
      case "temp":
        return `<svg ${common}><path d="M14 14.76V3a2 2 0 0 0-4 0v11.76a4 4 0 1 0 4 0Z"/></svg>`;
      case "duration":
        return `<svg ${common}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    }
  };

  const row = (icon: "speed" | "heart" | "elevation" | "cadence" | "power" | "temp" | "duration", label: string, value: string) => (
    `<div class="tt-row"><span class="tt-row-left"><span class="tt-icon">${iconSvg(icon)}</span><span>${label}</span></span><strong>${value}</strong></div>`
  );

  const rows: string[] = [];
  if (speed !== null && speed > 0) {
    const speedValue = convertSpeedKmh(speed, distanceUnit);
    const speedUnit = speedLabel(distanceUnit);
    rows.push(row("speed", "Speed", `${fmt2(speedValue)} ${speedUnit}`));
  }
  if (heartRate !== null && heartRate > 0)
    rows.push(row("heart", "Heart", `${fmt2(heartRate)} bpm`));
  if (altitude !== null)
    rows.push(row("elevation", "Elevation", `${fmt2(convertElevationMeters(altitude, distanceUnit))} ${elevationLabel(distanceUnit)}`));
  if (cadence !== null && cadence > 0)
    rows.push(row("cadence", "Cadence", `${fmt2(cadence)} rpm`));
  if (power !== null && power > 0)
    rows.push(row("power", "Power", `${fmt2(power)} W`));
  rows.push(row("temp", "Temp", temp !== null ? `${fmt2(temp)} &deg;C` : "&mdash;"));
  if (elapsed !== null)
    rows.push(row("duration", "Duration", formatElapsed(elapsed)));
  if (rows.length === 0) return `<div class="map-tooltip"><em style="color:var(--text-muted)">No data at this point</em></div>`;
  return `<div class="map-tooltip">${rows.join("")}</div>`;
}

function formatMetric(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits).replace(/\.00$/, "").replace(/(\.\d*[1-9])0$/, "$1");
}

function sampleRouteRecords(records: RecordPoint[], maxPoints: number): RecordPoint[] {
  if (records.length <= maxPoints) return records;
  const sampled: RecordPoint[] = [];
  const lastIndex = records.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i / (maxPoints - 1)) * lastIndex);
    sampled.push(records[index]);
  }
  return sampled;
}

/* ── Component ───────────────────────────────────────────────────── */

const SOURCE_ID = "activity-route";
const HIT_SOURCE_ID = "activity-route-hit-source";
const MARKER_SOURCE_ID = "activity-route-markers";
const LAP_SOURCE_ID = "activity-route-lap-markers";
const SKY_LAYER_ID = "activity-sky-layer";
const OUTLINE_LAYER_ID = "activity-route-outline-layer";
const LAYER_ID = "activity-route-layer";
const HIT_LAYER_ID = "activity-route-hit";
const MARKER_LAYER_ID = "activity-route-markers-layer";
const MARKER_LABEL_LAYER_ID = "activity-route-markers-label-layer";
const LAP_LAYER_ID = "activity-route-lap-markers-layer";
const LAP_LABEL_LAYER_ID = "activity-route-lap-markers-label-layer";

function buildLapMarkerGeoJson(gpsRecs: RecordPoint[], lapTimestampsUtc: string[]): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  if (!gpsRecs.length || !lapTimestampsUtc.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: GeoJSON.Feature<GeoJSON.Geometry>[] = [];
  for (let i = 0; i < lapTimestampsUtc.length; i++) {
    const tsMs = Date.parse(lapTimestampsUtc[i]);
    if (!Number.isFinite(tsMs)) continue;

    let nearestIdx = -1;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let j = 0; j < gpsRecs.length; j++) {
      const rec = gpsRecs[j];
      if (typeof rec.latitude !== "number" || typeof rec.longitude !== "number") continue;
      const delta = Math.abs(rec.timestamp_ms - tsMs);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIdx = j;
      }
    }

    if (nearestIdx < 0) continue;
    const rec = gpsRecs[nearestIdx];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [rec.longitude as number, rec.latitude as number] },
      properties: {
        label: String(i + 1),
        ts: lapTimestampsUtc[i],
      }
    });
  }

  return { type: "FeatureCollection", features };
}

export function ActivityMap({ records, mapStyle, setMapStyle, lapTimestampsUtc = [] }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const distanceUnit = useSettingsStore((s) => s.distanceUnit);
  const selectedStyle = mapStyle === "default" ? theme : mapStyle;
  const { t } = useTranslation();

  const pathColorLabels: Record<PathColorMode, string> = useMemo(() => ({
    solid: t("activityMap.colorSolid"),
    speed: t("activityMap.colorSpeed"),
    heart_rate: t("activityMap.colorHeartRate"),
    cadence: t("activityMap.colorCadence"),
    altitude: t("activityMap.colorAltitude"),
    power: t("activityMap.colorPower"),
    temperature: t("activityMap.colorTemperature"),
    time: t("activityMap.colorTime"),
  }), [t]);

  const [pathColorMode, setPathColorMode] = useState<PathColorMode>("heart_rate");
  const [terrainEnabled, setTerrainEnabled] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeedIndex, setPlaybackSpeedIndex] = useState(0);
  const pathColorModeRef = useRef(pathColorMode);
  const terrainEnabledRef = useRef(terrainEnabled);
  const telemetryEnabledRef = useRef(telemetryEnabled);
  const timelineIndexRef = useRef(timelineIndex);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const playheadFloatRef = useRef(0);
  const playheadElapsedMsRef = useRef(0);

  const gpsRecords = useMemo(() => {
    const rows = records.filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number");
    return sampleRouteRecords(rows, 6000);
  }, [records]);

  const coordinates = useMemo(
    () => gpsRecords.map((r) => [r.longitude as number, r.latitude as number]),
    [gpsRecords]
  );

  const gpsRecordsRef = useRef(gpsRecords);
  const coordinatesRef = useRef(coordinates);
  const distanceUnitRef = useRef(distanceUnit);
  const maxTimelineIndex = Math.max(0, coordinates.length - 1);
  const playbackSpeed = PLAYBACK_SPEEDS[playbackSpeedIndex];

  const firstTimestampMs = useMemo(
    () => gpsRecords.find((r) => Number.isFinite(r.timestamp_ms))?.timestamp_ms ?? 0,
    [gpsRecords]
  );

  const totalElapsedSeconds = useMemo(() => {
    if (!gpsRecords.length) return 0;
    const lastTsMs = gpsRecords[gpsRecords.length - 1].timestamp_ms;
    if (!Number.isFinite(lastTsMs) || !Number.isFinite(firstTimestampMs)) return 0;
    return Math.max(0, Math.round((lastTsMs - firstTimestampMs) / 1000));
  }, [gpsRecords, firstTimestampMs]);
  const totalElapsedMs = Math.max(0, totalElapsedSeconds * 1000);

  const currentPoint = gpsRecords[Math.min(Math.max(timelineIndex, 0), Math.max(0, gpsRecords.length - 1))];
  const currentElapsedSeconds = currentPoint && Number.isFinite(currentPoint.timestamp_ms)
    ? Math.max(0, Math.round((currentPoint.timestamp_ms - firstTimestampMs) / 1000))
    : 0;

  const telemetryData = useMemo(() => {
    if (!currentPoint) return null;
    const speedKmh = (currentPoint.speed_m_s ?? 0) * 3.6;
    const speedValue = convertSpeedKmh(speedKmh, distanceUnit);
    const speedUnit = speedLabel(distanceUnit);
    return {
      time: formatElapsed(currentElapsedSeconds),
      speed: `${formatMetric(speedValue, 2)} ${speedUnit}`,
      heartRate: currentPoint.heart_rate ? `${formatMetric(currentPoint.heart_rate, 0)} bpm` : "--",
      altitude: currentPoint.altitude_m != null ? `${formatMetric(convertElevationMeters(currentPoint.altitude_m, distanceUnit), 0)} ${elevationLabel(distanceUnit)}` : "--",
      cadence: currentPoint.cadence ? `${formatMetric(currentPoint.cadence, 0)} rpm` : "--",
      power: currentPoint.power ? `${formatMetric(currentPoint.power, 0)} W` : "--",
      temp: Number.isFinite(currentPoint.temperature_c) ? `${formatMetric(currentPoint.temperature_c, 1)} C` : "--",
      point: `${timelineIndex + 1}/${Math.max(1, gpsRecords.length)}`,
    };
  }, [currentPoint, currentElapsedSeconds, distanceUnit, gpsRecords.length, timelineIndex]);

  useEffect(() => { coordinatesRef.current = coordinates; }, [coordinates]);
  useEffect(() => { gpsRecordsRef.current = gpsRecords; }, [gpsRecords]);
  useEffect(() => { distanceUnitRef.current = distanceUnit; }, [distanceUnit]);
  useEffect(() => { pathColorModeRef.current = pathColorMode; }, [pathColorMode]);
  useEffect(() => { terrainEnabledRef.current = terrainEnabled; }, [terrainEnabled]);
  useEffect(() => {
    telemetryEnabledRef.current = telemetryEnabled;
    if (telemetryEnabled) {
      popupRef.current?.remove();
    }
  }, [telemetryEnabled]);
  useEffect(() => {
    timelineIndexRef.current = timelineIndex;
    playheadFloatRef.current = timelineIndex;
    const point = gpsRecords[Math.min(Math.max(timelineIndex, 0), Math.max(0, gpsRecords.length - 1))];
    if (point && Number.isFinite(point.timestamp_ms)) {
      playheadElapsedMsRef.current = Math.max(0, point.timestamp_ms - firstTimestampMs);
    }
  }, [timelineIndex, gpsRecords, firstTimestampMs]);

  useEffect(() => {
    const endIndex = Math.max(0, coordinates.length - 1);
    timelineIndexRef.current = endIndex;
    playheadFloatRef.current = endIndex;
    playheadElapsedMsRef.current = totalElapsedMs;
    setTimelineIndex(endIndex);
    setIsPlaying(false);
  }, [coordinates.length, totalElapsedMs]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }

    if (coordinates.length < 2) {
      setIsPlaying(false);
      return;
    }

    const getIndexForElapsedMs = (elapsedMs: number): number => {
      const points = gpsRecordsRef.current;
      if (!points.length) return 0;
      const targetTs = firstTimestampMs + Math.max(0, elapsedMs);
      let lo = 0;
      let hi = points.length - 1;

      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (points[mid].timestamp_ms <= targetTs) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return lo;
    };

    const tick = (time: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = time;
      }
      const deltaSeconds = (time - (lastFrameTimeRef.current ?? time)) / 1000;
      lastFrameTimeRef.current = time;

      const maxIndex = Math.max(0, coordinatesRef.current.length - 1);
      const nextElapsedMs = playheadElapsedMsRef.current + (deltaSeconds * 1000 * PLAYBACK_SPEEDS[playbackSpeedIndex]);

      if (nextElapsedMs >= totalElapsedMs) {
        playheadElapsedMsRef.current = totalElapsedMs;
        playheadFloatRef.current = maxIndex;
        timelineIndexRef.current = maxIndex;
        setTimelineIndex(maxIndex);
        setIsPlaying(false);
        return;
      }

      playheadElapsedMsRef.current = Math.max(0, nextElapsedMs);
      const rounded = getIndexForElapsedMs(playheadElapsedMsRef.current);
      playheadFloatRef.current = rounded;
      if (rounded !== timelineIndexRef.current) {
        timelineIndexRef.current = rounded;
        setTimelineIndex(rounded);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
    };
  }, [isPlaying, playbackSpeedIndex, coordinates.length, firstTimestampMs, totalElapsedMs]);

  /* ── Draw route ─────────────────────────────────────────────── */

  function applyTerrainState(map: maplibregl.Map, enabled: boolean) {
    if (!enabled) {
      map.setMaxPitch(0);
      if (map.getLayer(SKY_LAYER_ID)) {
        map.removeLayer(SKY_LAYER_ID);
      }
      map.easeTo({ pitch: 0, duration: 250 });
      return;
    }

    map.setMaxPitch(85);

    if (!map.getLayer(SKY_LAYER_ID)) {
      map.addLayer({
        id: SKY_LAYER_ID,
        type: "sky",
        paint: {
          "sky-color": "#87CEEB",
          "sky-horizon-blend": 0.5,
        },
      } as any);
    }
  }

  function drawRoute(map: maplibregl.Map, fitToRoute: boolean) {
    const coords = coordinatesRef.current;
    const gpsRecs = gpsRecordsRef.current;
    const mode = pathColorModeRef.current;
    const solidPathColor = "#d65252";

    if (!coords.length) {
      if (map.getLayer(LAP_LABEL_LAYER_ID)) map.removeLayer(LAP_LABEL_LAYER_ID);
      if (map.getLayer(LAP_LAYER_ID)) map.removeLayer(LAP_LAYER_ID);
      if (map.getLayer(MARKER_LABEL_LAYER_ID)) map.removeLayer(MARKER_LABEL_LAYER_ID);
      if (map.getLayer(MARKER_LAYER_ID)) map.removeLayer(MARKER_LAYER_ID);
      if (map.getLayer(HIT_LAYER_ID)) map.removeLayer(HIT_LAYER_ID);
      if (map.getLayer(OUTLINE_LAYER_ID)) map.removeLayer(OUTLINE_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(LAP_SOURCE_ID)) map.removeSource(LAP_SOURCE_ID);
      if (map.getSource(MARKER_SOURCE_ID)) map.removeSource(MARKER_SOURCE_ID);
      if (map.getSource(HIT_SOURCE_ID)) map.removeSource(HIT_SOURCE_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      return;
    }

    const endIndex = Math.max(1, Math.min(coords.length - 1, timelineIndexRef.current));
    const visibleCoords = coords.slice(0, endIndex + 1);
    const visibleGpsRecs = gpsRecs.slice(0, endIndex + 1);

    const hitGeojson = buildColoredGeoJson(visibleGpsRecs, visibleCoords, mode, solidPathColor);
    const displayGeojson = buildSolidDisplayGeoJson(visibleCoords, solidPathColor);
    const markerGeojson = buildMarkerGeoJson(visibleCoords);
    const lapMarkerGeojson = buildLapMarkerGeoJson(visibleGpsRecs, lapTimestampsUtc);
    const gradientExpr = buildGradientExpression(visibleGpsRecs, mode, solidPathColor);
    const existingDisplay = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const existingHit = map.getSource(HIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const existingMarkers = map.getSource(MARKER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const existingLapMarkers = map.getSource(LAP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

    if (existingDisplay) {
      existingDisplay.setData(displayGeojson);
    } else {
      map.addSource(SOURCE_ID, { type: "geojson", data: displayGeojson, lineMetrics: true });
    }

    // Diffused black outline under the route for better edge contrast.
    if (!map.getLayer(OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: OUTLINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 8,
          "line-color": "#000000",
          "line-opacity": 0.62,
          "line-blur": 2.2,
        }
      });
    }

    if (existingHit) {
      existingHit.setData(hitGeojson);
    } else {
      map.addSource(HIT_SOURCE_ID, { type: "geojson", data: hitGeojson });
    }

    if (existingMarkers) {
      existingMarkers.setData(markerGeojson);
    } else {
      map.addSource(MARKER_SOURCE_ID, { type: "geojson", data: markerGeojson });
    }

    if (existingLapMarkers) {
      existingLapMarkers.setData(lapMarkerGeojson);
    } else {
      map.addSource(LAP_SOURCE_ID, { type: "geojson", data: lapMarkerGeojson });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 4,
          "line-color": solidPathColor,
          "line-opacity": 1
        }
      });
    }
    map.setPaintProperty(LAYER_ID, "line-color", solidPathColor);
    map.setPaintProperty(LAYER_ID, "line-gradient", gradientExpr as any);
    map.setPaintProperty(LAYER_ID, "line-opacity", 1);

    // Invisible wider hit-area layer for easier hover detection
    if (!map.getLayer(HIT_LAYER_ID)) {
      map.addLayer({
        id: HIT_LAYER_ID,
        type: "line",
        source: HIT_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 20,
          "line-color": "rgba(0,0,0,0)",
          "line-opacity": 0
        }
      });
    }

    if (!map.getLayer(LAP_LAYER_ID)) {
      map.addLayer({
        id: LAP_LAYER_ID,
        type: "circle",
        source: LAP_SOURCE_ID,
        paint: {
          "circle-radius": 7,
          "circle-color": "#4f46e5",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5
        }
      });
    }

    if (!map.getLayer(LAP_LABEL_LAYER_ID)) {
      map.addLayer({
        id: LAP_LABEL_LAYER_ID,
        type: "symbol",
        source: LAP_SOURCE_ID,
        layout: {
          "text-field": ["get", "label"] as any,
          "text-size": 10,
          "text-font": ["Open Sans Bold"]
        },
        paint: {
          "text-color": "#ffffff"
        }
      });
    }

    if (!map.getLayer(MARKER_LAYER_ID)) {
      map.addLayer({
        id: MARKER_LAYER_ID,
        type: "circle",
        source: MARKER_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"] as any,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5
        }
      });
    }

    if (!map.getLayer(MARKER_LABEL_LAYER_ID)) {
      map.addLayer({
        id: MARKER_LABEL_LAYER_ID,
        type: "symbol",
        source: MARKER_SOURCE_ID,
        layout: {
          "text-field": ["get", "label"] as any,
          "text-size": 9,
          "text-font": ["Open Sans Bold"]
        },
        paint: {
          "text-color": "#ffffff"
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

  function resetZoomToRoute() {
    const map = mapRef.current;
    const coords = coordinatesRef.current;
    if (!map || !coords.length) return;
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
    );
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 550 });
  }

  function togglePlayback() {
    if (coordinates.length < 2) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (timelineIndexRef.current >= maxTimelineIndex) {
      timelineIndexRef.current = 0;
      playheadFloatRef.current = 0;
      playheadElapsedMsRef.current = 0;
      setTimelineIndex(0);
    }
    setIsPlaying(true);
  }

  /* ── Map lifecycle ──────────────────────────────────────────── */

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleFromMap(mapStyle, theme),
      center: [0, 0],
      zoom: 2,
      minZoom: 5,
      pitch: 0,
      bearing: 0,
      maxPitch: 0,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      applyTerrainState(map, terrainEnabledRef.current);
      drawRoute(map, true);
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    // Hover tooltip popup
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "220px" });
    popupRef.current = popup;

    map.on("mousemove", HIT_LAYER_ID, (e) => {
      if (telemetryEnabledRef.current) {
        map.getCanvas().style.cursor = "";
        popup.remove();
        return;
      }
      if (!e.features?.[0]) return;
      map.getCanvas().style.cursor = "crosshair";
      const props = e.features[0].properties as Record<string, any>;
      popup.setLngLat(e.lngLat).setHTML(buildTooltipHtml(props, distanceUnitRef.current)).addTo(map);
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
      applyTerrainState(map, terrainEnabledRef.current);
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

    const apply = () => {
      applyTerrainState(map, terrainEnabled);
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      const onIdle = () => { map.off("idle", onIdle); apply(); };
      map.on("idle", onIdle);
      return () => { map.off("idle", onIdle); };
    }
  }, [terrainEnabled]);

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
  }, [coordinates, lapTimestampsUtc]);

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
  }, [timelineIndex]);

  return (
    <section className="panel map-panel">
      <div className="map-header">
        <h3>{t("activityMap.gpsRoute")}</h3>
        <div className="map-controls">
          <div className="map-control">
            <span>{t("activityMap.style")}</span>
            <select value={selectedStyle} onChange={(e) => setMapStyle(e.target.value as MapStyle)}>
              {Object.entries(BASEMAPS).map(([value, info]) => (
                <option key={value} value={value}>{info.label}</option>
              ))}
            </select>
          </div>
          <div className="map-control">
            <span>{t("activityMap.color")}</span>
            <select value={pathColorMode} onChange={(e) => setPathColorMode(e.target.value as PathColorMode)}>
              {PATH_COLOR_VALUES.map((val) => (
                <option key={val} value={val}>{pathColorLabels[val]}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={`btn-outline-secondary map-toggle-btn ${terrainEnabled ? "active" : ""}`}
            onClick={() => setTerrainEnabled((v) => !v)}
          >
            {t("activityMap.terrain")} {terrainEnabled ? t("activityMap.on") : t("activityMap.off")}
          </button>
          <button
            type="button"
            className={`btn-outline-secondary map-toggle-btn ${telemetryEnabled ? "active" : ""}`}
            onClick={() => setTelemetryEnabled((v) => !v)}
          >
            {t("activityMap.telemetry")} {telemetryEnabled ? t("activityMap.on") : t("activityMap.off")}
          </button>
        </div>
      </div>

      <div className="map-canvas-wrap">
        <div ref={mapContainerRef} className="map-canvas" />
        <button className="btn-outline-secondary map-reset-zoom-btn" onClick={resetZoomToRoute}>
          {t("activityMap.resetZoom")}
        </button>
        {telemetryEnabled && telemetryData && (
          <div className="telemetry-overlay" aria-live="polite">
            <div className="telemetry-overlay-title">{t("activityMap.timelineTelemetry")}</div>
            <div className="telemetry-overlay-grid">
              <div><span>{t("activityMap.point")}</span><strong>{telemetryData.point}</strong></div>
              <div><span>{t("activityMap.time")}</span><strong>{telemetryData.time}</strong></div>
              <div><span>{t("activityMap.speed")}</span><strong>{telemetryData.speed}</strong></div>
              <div><span>{t("activityMap.heart")}</span><strong>{telemetryData.heartRate}</strong></div>
              <div><span>{t("activityMap.alt")}</span><strong>{telemetryData.altitude}</strong></div>
              <div><span>{t("activityMap.cadence")}</span><strong>{telemetryData.cadence}</strong></div>
              <div><span>{t("activityMap.power")}</span><strong>{telemetryData.power}</strong></div>
              <div><span>{t("activityMap.temp")}</span><strong>{telemetryData.temp}</strong></div>
            </div>
          </div>
        )}
      </div>

      <div className="map-playback-bar">
        <button className="btn-outline-secondary map-playback-btn" onClick={togglePlayback} disabled={coordinates.length < 2} style={{ padding: "0.32rem 0.6rem", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <input
          className="map-playback-range"
          type="range"
          min={0}
          max={Math.max(0, coordinates.length - 1)}
          step={1}
          value={Math.min(timelineIndex, Math.max(0, coordinates.length - 1))}
          disabled={coordinates.length < 2}
          onChange={(e) => {
            const next = Number(e.target.value);
            setIsPlaying(false);
            setTimelineIndex(next);
          }}
          style={{
            "--progress": coordinates.length > 1 
                ? `${(Math.min(timelineIndex, Math.max(0, coordinates.length - 1)) / Math.max(1, coordinates.length - 1)) * 100}%` 
                : "0%"
          } as React.CSSProperties}
        />
        <button
          className="btn-outline-secondary map-playback-speed"
          type="button"
          onClick={() => setPlaybackSpeedIndex((i) => (i + 1) % PLAYBACK_SPEEDS.length)}
          disabled={coordinates.length < 2}
        >
          {t("activityMap.speed")} {playbackSpeed}x
        </button>
        <span className="map-playback-time">{formatElapsed(currentElapsedSeconds)} / {formatElapsed(totalElapsedSeconds)}</span>
      </div>

      {pathColorMode !== "solid" && coordinates.length > 0 && (
        <div className="color-legend">
          <div className="color-gradient-bar" />
          <div className="color-labels">
            <span>{t("activityMap.low")}</span>
            <span>{pathColorLabels[pathColorMode]}</span>
            <span>{t("activityMap.high")}</span>
          </div>
        </div>
      )}

      {!coordinates.length && (
        <p className="small" style={{ textAlign: "center", padding: "0.5rem 0" }}>
          {t("activityMap.noGpsCoordinates")}
        </p>
      )}
    </section>
  );
}
