import type { RecordPoint } from "../types";

export type RecordDataAvailability = {
  hasGpsRoute: boolean;
  hasHeartRate: boolean;
  hasSpeed: boolean;
  hasPace: boolean;
  hasPower: boolean;
  hasCadence: boolean;
  hasTemperature: boolean;
  hasElevation: boolean;
};

const emptyAvailability: RecordDataAvailability = {
  hasGpsRoute: false,
  hasHeartRate: false,
  hasSpeed: false,
  hasPace: false,
  hasPower: false,
  hasCadence: false,
  hasTemperature: false,
  hasElevation: false,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasDerivedSpeed(records: RecordPoint[]): boolean {
  for (let i = 1; i < records.length; i += 1) {
    const current = records[i];
    const previous = records[i - 1];
    if (
      isFiniteNumber(current.distance_m) &&
      isFiniteNumber(previous.distance_m) &&
      isFiniteNumber(current.timestamp_ms) &&
      isFiniteNumber(previous.timestamp_ms) &&
      current.timestamp_ms > previous.timestamp_ms &&
      current.distance_m > previous.distance_m
    ) {
      return true;
    }
  }
  return false;
}

export function getRecordDataAvailability(records: RecordPoint[]): RecordDataAvailability {
  let gpsPointCount = 0;
  let hasHeartRate = false;
  let hasSpeed = false;
  let hasPower = false;
  let hasCadence = false;
  let hasTemperature = false;
  let hasElevation = false;

  for (const record of records) {
    if (isFiniteNumber(record.latitude) && isFiniteNumber(record.longitude)) gpsPointCount += 1;
    if (isFiniteNumber(record.heart_rate) && record.heart_rate > 0) hasHeartRate = true;
    if (isFiniteNumber(record.speed_m_s) && record.speed_m_s > 0) hasSpeed = true;
    if (isFiniteNumber(record.power) && record.power > 0) hasPower = true;
    if (isFiniteNumber(record.cadence) && record.cadence > 0) hasCadence = true;
    if (isFiniteNumber(record.temperature_c)) hasTemperature = true;
    if (isFiniteNumber(record.altitude_m)) hasElevation = true;
  }

  hasSpeed = hasSpeed || hasDerivedSpeed(records);

  return {
    hasGpsRoute: gpsPointCount >= 2,
    hasHeartRate,
    hasSpeed,
    hasPace: hasSpeed,
    hasPower,
    hasCadence,
    hasTemperature,
    hasElevation,
  };
}

export function combineRecordDataAvailability(items: RecordDataAvailability[]): RecordDataAvailability {
  return items.reduce<RecordDataAvailability>(
    (combined, item) => ({
      hasGpsRoute: combined.hasGpsRoute || item.hasGpsRoute,
      hasHeartRate: combined.hasHeartRate || item.hasHeartRate,
      hasSpeed: combined.hasSpeed || item.hasSpeed,
      hasPace: combined.hasPace || item.hasPace,
      hasPower: combined.hasPower || item.hasPower,
      hasCadence: combined.hasCadence || item.hasCadence,
      hasTemperature: combined.hasTemperature || item.hasTemperature,
      hasElevation: combined.hasElevation || item.hasElevation,
    }),
    emptyAvailability
  );
}
