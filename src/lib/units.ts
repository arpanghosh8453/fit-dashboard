export type DistanceUnit = "km" | "mi";

export const METERS_PER_KILOMETER = 1000;
export const METERS_PER_MILE = 1609.344;
export const FEET_PER_METER = 3.280839895;

export function distanceDivisor(unit: DistanceUnit): number {
  return unit === "mi" ? METERS_PER_MILE : METERS_PER_KILOMETER;
}

export function distanceLabel(unit: DistanceUnit): string {
  return unit;
}

export function speedLabel(unit: DistanceUnit): string {
  return unit === "mi" ? "mi/h" : "km/h";
}

export function paceLabel(unit: DistanceUnit): string {
  return unit === "mi" ? "min/mi" : "min/km";
}

export function elevationLabel(unit: DistanceUnit): string {
  return unit === "mi" ? "ft" : "m";
}

export function convertDistanceMeters(valueMeters: number, unit: DistanceUnit): number {
  return valueMeters / distanceDivisor(unit);
}

export function convertSpeedMps(valueMps: number, unit: DistanceUnit): number {
  const kmh = valueMps * 3.6;
  return unit === "mi" ? kmh / 1.609344 : kmh;
}

export function convertSpeedKmh(valueKmh: number, unit: DistanceUnit): number {
  return unit === "mi" ? valueKmh / 1.609344 : valueKmh;
}

export function convertElevationMeters(valueMeters: number, unit: DistanceUnit): number {
  return unit === "mi" ? valueMeters * FEET_PER_METER : valueMeters;
}

export function convertPaceMinPerKm(valueMinPerKm: number, unit: DistanceUnit): number {
  return unit === "mi" ? valueMinPerKm * 1.609344 : valueMinPerKm;
}
