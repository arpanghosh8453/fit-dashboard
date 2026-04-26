export type HeartRateZone = {
  name: string;
  minExclusive: number;
  maxInclusive: number | null;
  color: string;
};

const HR_ZONE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#06b6d4"];

export const DEFAULT_HEART_RATE_ZONES: HeartRateZone[] = [
  { name: "Z1 <=75 bpm", minExclusive: -Infinity, maxInclusive: 75, color: "#3b82f6" },
  { name: "Z2 76-95 bpm", minExclusive: 75, maxInclusive: 95, color: "#22c55e" },
  { name: "Z3 96-120 bpm", minExclusive: 95, maxInclusive: 120, color: "#eab308" },
  { name: "Z4 121-150 bpm", minExclusive: 120, maxInclusive: 150, color: "#f97316" },
  { name: "Z5 >150 bpm", minExclusive: 150, maxInclusive: null, color: "#ef4444" },
];

export function buildHeartRateZones(zoneUpperBoundsBpm?: number[] | null): HeartRateZone[] {
  if (!Array.isArray(zoneUpperBoundsBpm) || zoneUpperBoundsBpm.length === 0) {
    return DEFAULT_HEART_RATE_ZONES;
  }

  const bounds = Array.from(
    new Set(
      zoneUpperBoundsBpm
        .map((value) => Math.round(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0 && value < 260)
    )
  ).sort((a, b) => a - b);

  if (bounds.length < 2) {
    return DEFAULT_HEART_RATE_ZONES;
  }

  const zones: HeartRateZone[] = [];
  let minExclusive = -Infinity;

  for (let i = 0; i < bounds.length; i += 1) {
    const upper = bounds[i];
    const label = minExclusive === -Infinity ? `Z${i + 1} <=${upper} bpm` : `Z${i + 1} ${Math.round(minExclusive + 1)}-${upper} bpm`;
    zones.push({
      name: label,
      minExclusive,
      maxInclusive: upper,
      color: HR_ZONE_COLORS[i % HR_ZONE_COLORS.length],
    });
    minExclusive = upper;
  }

  zones.push({
    name: `Z${zones.length + 1} >${Math.round(minExclusive)} bpm`,
    minExclusive,
    maxInclusive: null,
    color: HR_ZONE_COLORS[zones.length % HR_ZONE_COLORS.length],
  });

  return zones;
}

export function resolveHeartRateZoneIndex(hr: number, zones: HeartRateZone[]): number {
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i];
    const inLower = hr > zone.minExclusive;
    const inUpper = zone.maxInclusive === null ? true : hr <= zone.maxInclusive;
    if (inLower && inUpper) return i;
  }
  return zones.length - 1;
}