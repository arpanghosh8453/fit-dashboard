export type ZoomRange = { start: number; end: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getDynamicSmoothingWindow(
  totalPoints: number,
  totalDurationMs: number,
  zoomRange: ZoomRange | null | undefined,
): number {
  if (totalPoints < 3 || totalDurationMs <= 0) return 1;

  const startPct = clamp(zoomRange?.start ?? 0, 0, 100);
  const endPct = clamp(zoomRange?.end ?? 100, 0, 100);
  const visibleFraction = Math.max(0.01, Math.abs(endPct - startPct) / 100);
  const visiblePoints = Math.max(2, Math.round(totalPoints * visibleFraction));
  const visibleDurationMs = Math.max(1000, totalDurationMs * visibleFraction);

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const targetPoints = clamp(Math.round(viewportWidth * 0.42), 140, 560);

  const densityWindow = Math.max(1, Math.round(visiblePoints / targetPoints));
  const avgStepMs = totalDurationMs / Math.max(1, totalPoints - 1);
  const durationPerPixelMs = visibleDurationMs / targetPoints;
  const durationWindow = Math.max(1, Math.round((durationPerPixelMs * 1.5) / Math.max(1, avgStepMs)));

  return clamp(Math.max(densityWindow, durationWindow), 1, 48);
}

export function applyRollingAverageSeries<T extends unknown[]>(
  series: T[],
  valueIndex: number,
  windowSize: number,
): T[] {
  if (windowSize <= 1 || series.length < 3) return series;

  const halfWindow = Math.floor(windowSize / 2);
  const prefixSum = new Array<number>(series.length + 1).fill(0);
  const prefixCount = new Array<number>(series.length + 1).fill(0);

  for (let i = 0; i < series.length; i += 1) {
    const value = Number(series[i][valueIndex]);
    const hasValue = Number.isFinite(value);
    prefixSum[i + 1] = prefixSum[i] + (hasValue ? value : 0);
    prefixCount[i + 1] = prefixCount[i] + (hasValue ? 1 : 0);
  }

  return series.map((row, index) => {
    const rowCopy = [...row] as T;
    const currentValue = Number(row[valueIndex]);
    if (!Number.isFinite(currentValue)) return rowCopy;

    const from = Math.max(0, index - halfWindow);
    const to = Math.min(series.length - 1, index + halfWindow);
    const count = prefixCount[to + 1] - prefixCount[from];
    if (count <= 0) return rowCopy;

    const sum = prefixSum[to + 1] - prefixSum[from];
    rowCopy[valueIndex] = Number((sum / count).toFixed(2)) as T[number];
    return rowCopy;
  });
}
