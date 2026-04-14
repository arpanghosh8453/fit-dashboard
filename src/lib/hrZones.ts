export type HeartRateZone = {
  name: string;
  minExclusive: number;
  maxInclusive: number | null;
  color: string;
};

export const HEART_RATE_ZONES: HeartRateZone[] = [
  { name: "Z1 <=75 bpm", minExclusive: -Infinity, maxInclusive: 75, color: "#3b82f6" },
  { name: "Z2 76-95 bpm", minExclusive: 75, maxInclusive: 95, color: "#22c55e" },
  { name: "Z3 96-120 bpm", minExclusive: 95, maxInclusive: 120, color: "#eab308" },
  { name: "Z4 121-150 bpm", minExclusive: 120, maxInclusive: 150, color: "#f97316" },
  { name: "Z5 >150 bpm", minExclusive: 150, maxInclusive: null, color: "#ef4444" },
];

export function resolveHeartRateZoneIndex(hr: number): number {
  for (let i = 0; i < HEART_RATE_ZONES.length; i += 1) {
    const zone = HEART_RATE_ZONES[i];
    const inLower = hr > zone.minExclusive;
    const inUpper = zone.maxInclusive === null ? true : hr <= zone.maxInclusive;
    if (inLower && inUpper) return i;
  }
  return HEART_RATE_ZONES.length - 1;
}