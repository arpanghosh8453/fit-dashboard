import type { RecordPoint } from "../types";
import { convertDistanceMeters, distanceLabel, type DistanceUnit } from "./units";

export type TelemetryXAxisMode = "time" | "distance";

export type TelemetryPoint = {
  x: number | null;
  relMs: number;
  timestampMs: number;
  distanceMeters: number | null;
};

type LapMarker = { xAxis: number; name: string };

function finiteDistanceMeters(record: RecordPoint): number | null {
  return typeof record.distance_m === "number" && Number.isFinite(record.distance_m)
    ? Math.max(0, record.distance_m)
    : null;
}

export function hasUsableDistanceAxis(records: RecordPoint[]): boolean {
  return records.some((record) => {
    const distanceMeters = finiteDistanceMeters(record);
    return distanceMeters !== null && distanceMeters > 0;
  });
}

export function buildTelemetryPoints(
  records: RecordPoint[],
  startTimestampMs: number,
  mode: TelemetryXAxisMode,
  distanceUnit: DistanceUnit,
): TelemetryPoint[] {
  return records.map((record) => {
    const distanceMeters = finiteDistanceMeters(record);
    return {
      x: mode === "distance"
        ? (distanceMeters === null ? null : convertDistanceMeters(distanceMeters, distanceUnit))
        : record.timestamp_ms - startTimestampMs,
      relMs: record.timestamp_ms - startTimestampMs,
      timestampMs: record.timestamp_ms,
      distanceMeters,
    };
  });
}

export function formatRelTime(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatAbsTime(baseTimestampMs: number, relMs: number): string {
  const absolute = new Date(baseTimestampMs + Math.max(0, relMs));
  const hh = String(absolute.getHours()).padStart(2, "0");
  const mm = String(absolute.getMinutes()).padStart(2, "0");
  const ss = String(absolute.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatDistanceAxisTick(value: number, unit: DistanceUnit): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${distanceLabel(unit)}`;
}

export function formatTelemetryXAxisTick(
  value: number,
  mode: TelemetryXAxisMode,
  distanceUnit: DistanceUnit,
): string {
  return mode === "distance" ? formatDistanceAxisTick(value, distanceUnit) : formatRelTime(value);
}

export function formatTelemetryTooltipHeader(
  mode: TelemetryXAxisMode,
  baseTimestampMs: number,
  relMs: number,
  distanceMeters: number | null,
  distanceUnit: DistanceUnit,
): string {
  const distanceValue = distanceMeters === null ? null : convertDistanceMeters(distanceMeters, distanceUnit);
  const primary = mode === "distance" && distanceValue !== null
    ? formatDistanceAxisTick(distanceValue, distanceUnit)
    : formatRelTime(relMs);
  const badges = [formatAbsTime(baseTimestampMs, relMs)];

  if (mode === "distance") {
    badges.unshift(formatRelTime(relMs));
  } else if (distanceValue !== null) {
    badges.push(formatDistanceAxisTick(distanceValue, distanceUnit));
  }

  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><strong>${primary}</strong>${badges.map((label) => `<span style="display:inline-flex;align-items:center;border-radius:999px;padding:1px 6px;font-size:11px;background:rgba(148,163,184,0.22);">${label}</span>`).join("")}</div>`;
}

function distanceAtTimestamp(records: RecordPoint[], timestampMs: number): number | null {
  let before: RecordPoint | null = null;
  let after: RecordPoint | null = null;

  for (const record of records) {
    if (record.timestamp_ms <= timestampMs) {
      before = record;
    }
    if (record.timestamp_ms >= timestampMs) {
      after = record;
      break;
    }
  }

  const beforeDistance = before ? finiteDistanceMeters(before) : null;
  const afterDistance = after ? finiteDistanceMeters(after) : null;

  if (before && after && beforeDistance !== null && afterDistance !== null) {
    if (after.timestamp_ms === before.timestamp_ms) return beforeDistance;
    const ratio = Math.max(0, Math.min(1, (timestampMs - before.timestamp_ms) / (after.timestamp_ms - before.timestamp_ms)));
    return beforeDistance + (afterDistance - beforeDistance) * ratio;
  }

  if (beforeDistance !== null && afterDistance !== null) {
    return Math.abs(timestampMs - (before?.timestamp_ms ?? timestampMs)) <= Math.abs(timestampMs - (after?.timestamp_ms ?? timestampMs))
      ? beforeDistance
      : afterDistance;
  }

  return beforeDistance ?? afterDistance;
}

export function buildLapMarkers(
  records: RecordPoint[],
  lapTimestampsUtc: string[],
  startTimestampMs: number,
  mode: TelemetryXAxisMode,
  distanceUnit: DistanceUnit,
): LapMarker[] {
  return lapTimestampsUtc
    .slice(1)
    .map((timestamp, idx) => {
      const parsed = Date.parse(timestamp);
      if (!Number.isFinite(parsed)) return null;

      if (mode === "distance") {
        const distanceMeters = distanceAtTimestamp(records, parsed);
        if (distanceMeters === null) return null;
        return { xAxis: convertDistanceMeters(distanceMeters, distanceUnit), name: `Lap ${idx + 1}` };
      }

      const relMs = parsed - startTimestampMs;
      if (relMs < 0) return null;
      return { xAxis: relMs, name: `Lap ${idx + 1}` };
    })
    .filter((marker): marker is LapMarker => marker !== null);
}
