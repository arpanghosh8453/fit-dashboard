import type { RecordPoint } from "../types";
import { convertDistanceMeters, distanceLabel, type DistanceUnit } from "./units";

export type TelemetryXAxisMode = "time" | "distance";

export type TelemetryTimerMetadata = {
  active_time_supported?: boolean;
  intervals_reliable?: boolean;
  stopped_intervals?: Array<{
    start_ts_utc?: string | null;
    end_ts_utc?: string | null;
    duration_s?: number | null;
    trigger?: string | null;
    resume_trigger?: string | null;
  }>;
};

export type TelemetryPoint = {
  x: number | null;
  relMs: number;
  elapsedMs: number;
  timestampMs: number;
  distanceMeters: number | null;
  record: RecordPoint;
};

export type TelemetryXAxisBounds = {
  min: number;
  max?: number;
};

type LapMarker = { xAxis: number; name: string };

type StoppedIntervalMs = {
  startMs: number;
  endMs: number;
};

function finiteDistanceMeters(record: RecordPoint): number | null {
  return typeof record.distance_m === "number" && Number.isFinite(record.distance_m)
    ? Math.max(0, record.distance_m)
    : null;
}

function parseTimestampMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReliableStoppedIntervals(timerMetadata?: TelemetryTimerMetadata | null): StoppedIntervalMs[] {
  if (!timerMetadata?.active_time_supported || !timerMetadata?.intervals_reliable) return [];

  const intervals = (timerMetadata.stopped_intervals ?? [])
    .map((interval) => {
      const startMs = parseTimestampMs(interval.start_ts_utc);
      const endMs = parseTimestampMs(interval.end_ts_utc);
      if (startMs === null || endMs === null || endMs <= startMs) return null;
      return { startMs, endMs };
    })
    .filter((interval): interval is StoppedIntervalMs => interval !== null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: StoppedIntervalMs[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function isTimestampStopped(timestampMs: number, intervals: StoppedIntervalMs[]): boolean {
  return intervals.some((interval) => timestampMs >= interval.startMs && timestampMs < interval.endMs);
}

function stoppedDurationBeforeMs(timestampMs: number, intervals: StoppedIntervalMs[]): number {
  let stoppedMs = 0;
  for (const interval of intervals) {
    if (timestampMs <= interval.startMs) break;
    stoppedMs += Math.max(0, Math.min(timestampMs, interval.endMs) - interval.startMs);
  }
  return stoppedMs;
}

export function activeElapsedMsAtTimestamp(
  timestampMs: number,
  startTimestampMs: number,
  timerMetadata?: TelemetryTimerMetadata | null,
): number {
  const intervals = getReliableStoppedIntervals(timerMetadata);
  const elapsedMs = Math.max(0, timestampMs - startTimestampMs);
  if (!intervals.length) return elapsedMs;
  return Math.max(0, elapsedMs - stoppedDurationBeforeMs(timestampMs, intervals));
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
  timerMetadata?: TelemetryTimerMetadata | null,
): TelemetryPoint[] {
  const intervals = getReliableStoppedIntervals(timerMetadata);

  return records.flatMap((record) => {
    if (intervals.length && isTimestampStopped(record.timestamp_ms, intervals)) return [];

    const distanceMeters = finiteDistanceMeters(record);
    const elapsedMs = Math.max(0, record.timestamp_ms - startTimestampMs);
    const relMs = intervals.length
      ? Math.max(0, elapsedMs - stoppedDurationBeforeMs(record.timestamp_ms, intervals))
      : elapsedMs;

    return [{
      x: mode === "distance"
        ? (distanceMeters === null ? null : convertDistanceMeters(distanceMeters, distanceUnit))
        : relMs,
      relMs,
      elapsedMs,
      timestampMs: record.timestamp_ms,
      distanceMeters,
      record,
    }];
  });
}

export function buildTelemetryXAxisBounds(points: Array<{ x: number | null }>): TelemetryXAxisBounds {
  let max = 0;

  for (const point of points) {
    if (typeof point.x === "number" && Number.isFinite(point.x)) {
      max = Math.max(max, point.x);
    }
  }

  return max > 0 ? { min: 0, max } : { min: 0 };
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
  return formatAbsTimestamp(baseTimestampMs + Math.max(0, relMs));
}

function formatAbsTimestamp(timestampMs: number): string {
  const absolute = new Date(timestampMs);
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
  timestampMs?: number,
): string {
  const distanceValue = distanceMeters === null ? null : convertDistanceMeters(distanceMeters, distanceUnit);
  const primary = mode === "distance" && distanceValue !== null
    ? formatDistanceAxisTick(distanceValue, distanceUnit)
    : formatRelTime(relMs);
  const absoluteMs = typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? timestampMs
    : baseTimestampMs + Math.max(0, relMs);
  const badges = [formatAbsTimestamp(absoluteMs)];

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
  timerMetadata?: TelemetryTimerMetadata | null,
): LapMarker[] {
  const intervals = getReliableStoppedIntervals(timerMetadata);
  const activeRecords = intervals.length
    ? records.filter((record) => !isTimestampStopped(record.timestamp_ms, intervals))
    : records;

  return lapTimestampsUtc
    .slice(1)
    .map((timestamp, idx) => {
      const parsed = Date.parse(timestamp);
      if (!Number.isFinite(parsed)) return null;

      if (mode === "distance") {
        const distanceMeters = distanceAtTimestamp(activeRecords, parsed);
        if (distanceMeters === null) return null;
        return { xAxis: convertDistanceMeters(distanceMeters, distanceUnit), name: `Lap ${idx + 1}` };
      }

      const relMs = activeElapsedMsAtTimestamp(parsed, startTimestampMs, timerMetadata);
      if (relMs < 0) return null;
      return { xAxis: relMs, name: `Lap ${idx + 1}` };
    })
    .filter((marker): marker is LapMarker => marker !== null);
}
