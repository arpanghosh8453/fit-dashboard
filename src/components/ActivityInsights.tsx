import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";
import { enableChartWheelPageScroll } from "../lib/chartScroll";
import { buildHeartRateZones, resolveHeartRateZoneIndex } from "../lib/hrZones";
import { applyRollingAverageSeries, getDynamicSmoothingWindow } from "../lib/chartSmoothing";
import {
  convertElevationMeters,
  convertSpeedMps,
  elevationLabel,
  speedLabel,
  type DistanceUnit,
} from "../lib/units";
import {
  buildLapMarkers,
  buildTelemetryPoints,
  buildTelemetryXAxisBounds,
  formatRelTime,
  formatTelemetryTooltipHeader,
  formatTelemetryXAxisTick,
  type TelemetryTimerMetadata,
  type TelemetryXAxisMode,
} from "../lib/telemetryAxis";
import { useTranslation } from "../lib/i18n";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
  distanceUnit: DistanceUnit;
  xAxisMode?: TelemetryXAxisMode;
  heartRateZoneBoundsBpm?: number[];
  zoomRange?: { start: number; end: number } | null;
  onZoomChange?: (range: { start: number; end: number }) => void;
  lapTimestampsUtc?: string[];
  smoothGraphs?: boolean;
  timerMetadata?: TelemetryTimerMetadata | null;
};

type SeriesRow = [number, number | null, number, number, number | null];

function isSeriesRow(row: [number | null, number | null, number, number, number | null]): row is SeriesRow {
  return typeof row[0] === "number" && Number.isFinite(row[0]);
}

function safeAvg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function ActivityInsights({
  records,
  theme,
  distanceUnit,
  xAxisMode = "time",
  heartRateZoneBoundsBpm,
  zoomRange,
  onZoomChange,
  lapTimestampsUtc = [],
  smoothGraphs = true,
  timerMetadata,
}: Props) {
  const hrZones = buildHeartRateZones(heartRateZoneBoundsBpm);
  const isDark = theme === "dark";
  const { t: tr } = useTranslation();
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const tooltipStyle = {
    backgroundColor: tooltipBg,
    borderColor: tooltipBorder,
    textStyle: { color: tooltipText, fontSize: 12 },
  };

  if (!records.length) {
    return (
      <div className="empty-state" style={{ minHeight: 200 }}>
        <span className="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg></span>
        <span>{tr("insights.emptyState")}</span>
      </div>
    );
  }

  const t0 = records[0]?.timestamp_ms ?? 0;
  const telemetryPoints = buildTelemetryPoints(records, t0, xAxisMode, distanceUnit, timerMetadata);
  const totalDurationMs = Math.max(0, telemetryPoints[telemetryPoints.length - 1]?.relMs ?? ((records[records.length - 1]?.timestamp_ms ?? t0) - t0));
  const smoothWindow = smoothGraphs ? getDynamicSmoothingWindow(telemetryPoints.length || records.length, totalDurationMs, zoomRange) : 1;
  const xAxisBounds = buildTelemetryXAxisBounds(telemetryPoints);
  const formatTooltipHeader = (relMs: number, distanceMeters: number | null, mode: TelemetryXAxisMode = xAxisMode, timestampMs?: number) =>
    formatTelemetryTooltipHeader(mode, t0, relMs, distanceMeters, distanceUnit, timestampMs);

  const timeline = telemetryPoints.map((point, i) => {
    const r = point.record;
    const prevPoint = i > 0 ? telemetryPoints[i - 1] : undefined;
    const prevRecord = prevPoint?.record;
    const dt = prevPoint ? (point.relMs - prevPoint.relMs) / 1000 : 0;
    const derivedSpeed =
      !r.speed_m_s && prevRecord && typeof r.distance_m === "number" && typeof prevRecord.distance_m === "number" && dt > 0
        ? Math.max(0, (r.distance_m - prevRecord.distance_m) / dt)
        : undefined;
    const speedMs = r.speed_m_s ?? derivedSpeed;
    const speedInUnit = typeof speedMs === "number" ? convertSpeedMps(speedMs, distanceUnit) : null;
    const paceMinPerUnit = speedInUnit && speedInUnit > 0 ? 60 / speedInUnit : null;
    return {
      x: point.x,
      relMs: point.relMs,
      distanceMeters: point.distanceMeters,
      speedInUnit,
      altitudeInUnit: typeof r.altitude_m === "number" ? convertElevationMeters(r.altitude_m, distanceUnit) : null,
      paceMinPerUnit,
      heartRate: r.heart_rate ?? null,
      power: r.power ?? null,
      cadence: r.cadence ?? null,
      temperatureC: r.temperature_c ?? null,
      timestampMs: point.timestampMs,
    };
  });

  const speedLineData = timeline.map((d) => [d.x, d.speedInUnit, d.relMs, d.timestampMs, d.distanceMeters] as [number | null, number | null, number, number, number | null]).filter(isSeriesRow);
  const elevationLineData = timeline.map((d) => [d.x, d.altitudeInUnit, d.relMs, d.timestampMs, d.distanceMeters] as [number | null, number | null, number, number, number | null]).filter(isSeriesRow);
  const cadenceLineData = timeline.map((d) => [d.x, d.cadence, d.relMs, d.timestampMs, d.distanceMeters] as [number | null, number | null, number, number, number | null]).filter(isSeriesRow);
  const powerLineData = timeline.map((d) => [d.x, d.power, d.relMs, d.timestampMs, d.distanceMeters] as [number | null, number | null, number, number, number | null]).filter(isSeriesRow);

  const speedLineDataSmoothed = smoothGraphs ? applyRollingAverageSeries(speedLineData, 1, smoothWindow) : speedLineData;
  const elevationLineDataSmoothed = smoothGraphs ? applyRollingAverageSeries(elevationLineData, 1, smoothWindow) : elevationLineData;
  const cadenceLineDataSmoothed = smoothGraphs ? applyRollingAverageSeries(cadenceLineData, 1, smoothWindow) : cadenceLineData;
  const powerLineDataSmoothed = smoothGraphs ? applyRollingAverageSeries(powerLineData, 1, smoothWindow) : powerLineData;

  const hasPowerData = timeline.some((d) => typeof d.power === "number" && d.power > 0);
  const hasHeartRateData = timeline.some((d) => typeof d.heartRate === "number" && d.heartRate > 0);

  const lapMarkers = buildLapMarkers(records, lapTimestampsUtc, t0, xAxisMode, distanceUnit, timerMetadata);

  const hrValues = timeline
    .map((d) => d.heartRate)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const zoneMinutes = hrZones.map(() => 0);
  if (hrValues.length > 0) {
    for (let i = 0; i < timeline.length - 1; i += 1) {
      const hr = timeline[i].heartRate;
      if (typeof hr !== "number" || hr <= 0) continue;
      const dtMin = Math.max(0, (timeline[i + 1].relMs - timeline[i].relMs) / 60000);
      const zoneIndex = resolveHeartRateZoneIndex(hr, hrZones);
      zoneMinutes[zoneIndex] += dtMin;
    }
  }

  const sharedXAxis = {
    type: "value",
    ...xAxisBounds,
    axisLabel: { color: axisColor, fontSize: 11, formatter: (val: number) => formatTelemetryXAxisTick(val, xAxisMode, distanceUnit) },
    axisLine: { lineStyle: { color: gridLine } },
    splitLine: { show: false },
  };

  const timelineOption = {
    tooltip: {
      trigger: "axis",
      ...tooltipStyle,
      formatter: (params: any[]) => {
        const p = params?.[0];
        const rel = Number(p?.value?.[2] ?? 0);
        const distanceMeters = (p?.value?.[4] ?? null) as number | null;
        let html = formatTooltipHeader(rel, distanceMeters, xAxisMode, Number(p?.value?.[3] ?? 0));
        for (const row of params) {
          if (row.value?.[1] !== null && row.value?.[1] !== undefined) {
            html += `<div>${row.marker} ${row.seriesName}: <strong>${Number(row.value[1]).toFixed(2)}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 50, right: 16, top: 42, bottom: 46 },
    xAxis: sharedXAxis,
    yAxis: {
      type: "value", name: speedLabel(distanceUnit),
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    dataZoom: [
      {
        type: "inside",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        start: zoomRange?.start ?? 0,
        end: zoomRange?.end ?? 100,
      },
    ],
    series: [
      {
        name: tr("insights.speed"), type: "line", smooth: smoothGraphs, showSymbol: false,
        lineStyle: { width: 2, color: "#38bdf8" },
        areaStyle: { color: isDark ? "rgba(56, 189, 248, 0.1)" : "rgba(56, 189, 248, 0.15)" },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: speedLineDataSmoothed,
        markLine: lapMarkers.length ? {
          animation: false,
          symbol: ["none", "none"],
          lineStyle: { color: isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)", type: "dashed", width: 1 },
          label: { color: axisColor, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: lapMarkers,
        } : undefined,
      },
    ],
  };

  const elevationOption = {
    tooltip: {
      trigger: "axis",
      ...tooltipStyle,
      formatter: (params: any[]) => {
        const p = params?.[0];
        const rel = Number(p?.value?.[2] ?? 0);
        const distanceMeters = (p?.value?.[4] ?? null) as number | null;
        const val = p?.value?.[1];
        return `${formatTooltipHeader(rel, distanceMeters, xAxisMode, Number(p?.value?.[3] ?? 0))}<div>${p?.marker ?? ""} ${tr("insights.elevation")}: <strong>${val == null ? "--" : Number(val).toFixed(2)} ${elevationLabel(distanceUnit)}</strong></div>`;
      }
    },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 50, right: 16, top: 42, bottom: 46 },
    xAxis: sharedXAxis,
    yAxis: {
      type: "value", name: elevationLabel(distanceUnit),
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    dataZoom: [
      {
        type: "inside",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        start: zoomRange?.start ?? 0,
        end: zoomRange?.end ?? 100,
      },
    ],
    series: [
      {
        name: tr("insights.elevation"), type: "line", smooth: smoothGraphs, showSymbol: false,
        lineStyle: { width: 1.5, color: "#f97316" },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: elevationLineDataSmoothed,
        markLine: lapMarkers.length ? {
          animation: false,
          symbol: ["none", "none"],
          lineStyle: { color: isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)", type: "dashed", width: 1 },
          label: { color: axisColor, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: lapMarkers,
        } : undefined,
      },
    ],
  };

  const zoneOption = {
    tooltip: {
      trigger: "item",
      ...tooltipStyle,
      formatter: (p: any) => `${p.marker} ${p.name}: <strong>${Number(p.value).toFixed(2)} min</strong>`
    },
    legend: { bottom: 0, textStyle: { color: axisColor, fontSize: 12 } },
    series: [
      {
        type: "pie",
        radius: ["38%", "72%"],
        padAngle: 2,
        itemStyle: {
          borderRadius: 8,
          borderColor: isDark ? "#0b1220" : "#ffffff",
          borderWidth: 3,
        },
        label: { color: axisColor, fontSize: 12, formatter: (p: any) => `${p.name}\n${Number(p.value).toFixed(1)} min` },
        data: hrZones.map((zone, idx) => ({
          name: zone.name,
          value: zoneMinutes[idx],
          itemStyle: { color: zone.color },
        })),
      },
    ],
  };

  const cadenceOption = {
    tooltip: {
      trigger: "axis",
      ...tooltipStyle,
      formatter: (params: any[]) => {
        const p = params?.[0];
        const rel = Number(p?.value?.[2] ?? 0);
        const distanceMeters = (p?.value?.[4] ?? null) as number | null;
        let html = formatTooltipHeader(rel, distanceMeters, xAxisMode, Number(p?.value?.[3] ?? 0));
        for (const row of params) {
          if (row.value?.[1] !== null && row.value?.[1] !== undefined) {
            const unit = row.seriesName === tr("insights.cadence") ? " rpm" : " W";
            html += `<div>${row.marker} ${row.seriesName}: <strong>${Number(row.value[1]).toFixed(2)}${unit}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 44, right: hasPowerData ? 44 : 16, top: 44, bottom: 44 },
    xAxis: sharedXAxis,
    yAxis: [
      {
        type: "value", name: "rpm",
        nameTextStyle: { color: axisColor, fontSize: 11 },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: gridLine } },
      },
      ...(hasPowerData ? [{
        type: "value", name: "W",
        nameTextStyle: { color: axisColor, fontSize: 11 },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { show: false },
      }] : []),
    ],
    dataZoom: [
      {
        type: "inside",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        start: zoomRange?.start ?? 0,
        end: zoomRange?.end ?? 100,
      },
    ],
    series: [
      {
        name: tr("insights.cadence"), type: "line", smooth: smoothGraphs, showSymbol: false,
        lineStyle: { width: 2, color: "#22d3ee" },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: cadenceLineDataSmoothed,
        markLine: lapMarkers.length ? {
          animation: false,
          symbol: ["none", "none"],
          lineStyle: { color: isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)", type: "dashed", width: 1 },
          label: { color: axisColor, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: lapMarkers,
        } : undefined,
      },
      ...(hasPowerData ? [{
        name: tr("insights.power"), type: "line", yAxisIndex: 1, smooth: smoothGraphs, showSymbol: false,
        sampling: smoothGraphs ? "lttb" : undefined,
        data: powerLineDataSmoothed,
        lineStyle: { color: "#f97316" },
      }] : []),
    ],
  };

  const hrPowerScatter = timeline
    .filter((d) => typeof d.heartRate === "number" && typeof d.power === "number")
    .map((d) => [d.heartRate as number, d.power as number]);

  const scatterOption = {
    tooltip: { trigger: "item", ...tooltipStyle },
    grid: { left: 44, right: 20, top: 28, bottom: 40 },
    xAxis: {
      type: "value", name: "HR",
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    yAxis: {
      type: "value", name: "W",
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [
      {
        type: "scatter",
        symbolSize: 5,
        itemStyle: { color: "#f59e0b", opacity: 0.7 },
        data: hrPowerScatter,
      },
    ],
  };

  const hrHistogram = (() => {
    if (!hrValues.length) {
      return { labels: [] as string[], counts: [] as number[], centers: [] as number[], binWidth: 1 };
    }
    const minHr = Math.floor(Math.min(...hrValues));
    const maxHr = Math.ceil(Math.max(...hrValues));
    const hrRange = Math.max(1, maxHr - minHr);
    const targetBins = Math.max(12, Math.min(72, Math.round(Math.sqrt(hrValues.length) * 2.2)));
    const binWidth = Math.max(1, Math.ceil(hrRange / targetBins));
    const start = Math.floor(minHr / binWidth) * binWidth;
    const end = Math.ceil(maxHr / binWidth) * binWidth;
    const binCount = Math.max(1, Math.ceil((end - start) / binWidth));
    const counts = new Array<number>(binCount).fill(0);

    for (const hr of hrValues) {
      const binIndex = Math.min(binCount - 1, Math.max(0, Math.floor((hr - start) / binWidth)));
      counts[binIndex] += 1;
    }

    const labels = counts.map((_, idx) => {
      const left = start + idx * binWidth;
      const right = left + binWidth;
      return `${left}-${right}`;
    });

    const centers = counts.map((_, idx) => {
      const left = start + idx * binWidth;
      return left + binWidth / 2;
    });

    return { labels, counts, centers, binWidth };
  })();

  const hrHistogramOption = {
    tooltip: {
      trigger: "item",
      ...tooltipStyle,
      formatter: (p: any) => {
        const label = String(p?.name ?? "");
        const count = Number(p?.value ?? 0);
        return `<div><strong>${label} bpm</strong></div><div>Samples: <strong>${count}</strong></div>`;
      },
    },
    grid: { left: 44, right: 16, top: 28, bottom: 56 },
    xAxis: {
      type: "category",
      name: `bpm (bin ~${hrHistogram.binWidth})`,
      data: hrHistogram.labels,
      nameTextStyle: { color: axisColor, fontSize: 11, padding: [26, 0, 0, 0] },
      axisLabel: { color: axisColor, fontSize: 10, interval: Math.max(0, Math.floor(hrHistogram.labels.length / 12)) },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "count",
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [
      {
        type: "bar",
        barGap: "0%",
        barWidth: "96%",
        itemStyle: { borderRadius: [2, 2, 0, 0] },
        data: hrHistogram.counts.map((count, idx) => {
          const centerHr = hrHistogram.centers[idx] ?? 0;
          const zone = hrZones[resolveHeartRateZoneIndex(centerHr, hrZones)];
          return {
            value: count,
            itemStyle: { color: zone.color },
          };
        }),
      },
    ],
  };

  const totalRelMs = Math.max(0, timeline[timeline.length - 1]?.relMs ?? totalDurationMs);
  const heatBins = Math.max(1, Math.ceil(totalRelMs / 60000));
  const heatMetrics = [
    {
      label: "HR",
      unit: "bpm",
      getter: (d: (typeof timeline)[number]) => d.heartRate,
      colors: isDark ? ["#2a0b12", "#dc2626", "#fb7185"] : ["#fee2e2", "#f87171", "#dc2626"],
    },
    {
      label: "Speed",
      unit: speedLabel(distanceUnit),
      getter: (d: (typeof timeline)[number]) => d.speedInUnit,
      colors: isDark ? ["#0e2a1e", "#16a34a", "#4ade80"] : ["#dcfce7", "#4ade80", "#15803d"],
    },
    {
      label: "Cadence",
      unit: "rpm",
      getter: (d: (typeof timeline)[number]) => d.cadence,
      colors: isDark ? ["#2f1a05", "#f59e0b", "#facc15"] : ["#fef3c7", "#fbbf24", "#d97706"],
    },
    {
      label: "Temp",
      unit: "degC",
      getter: (d: (typeof timeline)[number]) => d.temperatureC,
      colors: isDark ? ["#0b1a3a", "#1d4ed8", "#38bdf8"] : ["#dbeafe", "#60a5fa", "#1d4ed8"],
    },
  ] as const;

  const heatRowBounds = heatMetrics.map(() => ({ min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }));
  const rawHeatCells: Array<Array<{ x: number; raw: number | null }>> = heatMetrics.map(() => []);

  for (let x = 0; x < heatBins; x += 1) {
    const startMs = x * 60000;
    const endMs = startMs + 60000;
    const slice = timeline.filter((d) => d.relMs >= startMs && d.relMs < endMs);
    for (let row = 0; row < heatMetrics.length; row += 1) {
      const metricValue = safeAvg(slice.map((r) => heatMetrics[row].getter(r)));
      const raw = typeof metricValue === "number" && Number.isFinite(metricValue) ? Number(metricValue.toFixed(2)) : null;
      if (raw !== null) {
        heatRowBounds[row].min = Math.min(heatRowBounds[row].min, raw);
        heatRowBounds[row].max = Math.max(heatRowBounds[row].max, raw);
      }
      rawHeatCells[row].push({ x, raw });
    }
  }

  const heatSeriesData: Array<Array<{ value: [number, number, number]; raw: number | null; label: string; unit: string }>> =
    rawHeatCells.map((rowCells, row) => {
      const bounds = heatRowBounds[row];
      const hasBounds = Number.isFinite(bounds.min) && Number.isFinite(bounds.max);
      return rowCells.map(({ x, raw }) => {
        let normalized = 0;
        if (raw !== null && hasBounds) {
          normalized = bounds.max > bounds.min ? (raw - bounds.min) / (bounds.max - bounds.min) : 0.5;
        }
        return {
          value: [x, 0, Number(normalized.toFixed(4))],
          raw,
          label: heatMetrics[row].label,
          unit: heatMetrics[row].unit,
        };
      });
    });

  const rowTop = [16, 64, 112, 160];
  const rowHeight = 34;

  const heatOption = {
    tooltip: {
      position: "top",
      ...tooltipStyle,
      formatter: (p: any) => {
        const minuteIdx = Number(p?.value?.[0] ?? 0);
        const value = (p?.data?.raw ?? null) as number | null;
        const label = String(p?.data?.label ?? "Metric");
        const unit = String(p?.data?.unit ?? "");
        const startMs = minuteIdx * 60000;
        const endMs = (minuteIdx + 1) * 60000;
        const valueText = value === null ? "--" : `${value.toFixed(2)} ${unit}`;
        return `<div><strong>${label}</strong></div>${formatTooltipHeader(startMs, null, "time")}<div>${formatRelTime(startMs)} - ${formatRelTime(endMs)}: <strong>${valueText}</strong></div>`;
      },
    },
    grid: rowTop.map((top) => ({ left: 58, right: 14, top, height: rowHeight })),
    xAxis: rowTop.map((_, idx) => ({
      type: "category",
      gridIndex: idx,
      data: Array.from({ length: heatBins }, (_, i) => formatRelTime(i * 60000)),
      axisLabel: {
        show: idx === rowTop.length - 1,
        color: axisColor,
        interval: Math.max(0, Math.floor(heatBins / 14)),
        fontSize: 11,
      },
      axisLine: { show: idx === rowTop.length - 1, lineStyle: { color: gridLine } },
      axisTick: { show: idx === rowTop.length - 1 },
      splitLine: { show: false },
    })),
    yAxis: heatMetrics.map((metric, idx) => ({
      type: "category",
      gridIndex: idx,
      data: [metric.label],
      axisLabel: { color: axisColor, fontSize: 11 },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
    })),
    visualMap: heatMetrics.map((metric, idx) => ({
      show: false,
      min: 0,
      max: 1,
      dimension: 2,
      seriesIndex: idx,
      inRange: { color: metric.colors },
    })),
    series: heatMetrics.map((_, idx) => ({
      type: "heatmap",
      xAxisIndex: idx,
      yAxisIndex: idx,
      encode: { x: 0, y: 1, value: 2 },
      data: heatSeriesData[idx],
      emphasis: { itemStyle: { borderColor: isDark ? "#fff" : "#0f172a", borderWidth: 1 } },
    })),
  };

  const zoomEvents = {
    datazoom: (evt: any) => {
      const batch = evt?.batch?.[0];
      const start = typeof batch?.start === "number" ? batch.start : (typeof evt?.start === "number" ? evt.start : null);
      const end = typeof batch?.end === "number" ? batch.end : (typeof evt?.end === "number" ? evt.end : null);
      if (start !== null && end !== null) {
        onZoomChange?.({ start, end });
      }
    },
  };

  return (
    <section className="insight-grid">
      <article className="panel">
        <h3>{tr("insights.speedTrend")}</h3>
        <ReactECharts option={timelineOption} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
      </article>
      {hasPowerData && hasHeartRateData && (
        <article className="panel">
          <h3>{tr("insights.heartRateZoneTime")}</h3>
          <ReactECharts option={zoneOption} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
        </article>
      )}
      {hasHeartRateData && (
        <article className="panel">
          <h3>{tr("insights.hrHistogram")}</h3>
          <ReactECharts option={hrHistogramOption} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
        </article>
      )}
      <article className="panel">
        <h3>{hasPowerData ? tr("insights.cadenceAndPower") : tr("insights.cadence")}</h3>
        <ReactECharts option={cadenceOption} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>{tr("insights.effortHeatmap")}</h3>
        <ReactECharts option={heatOption} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>{tr("insights.elevation")}</h3>
        <ReactECharts option={elevationOption} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
      </article>
      {hasPowerData && hasHeartRateData && (
        <article className="panel">
          <h3>{tr("insights.powerVsHeartRate")}</h3>
          <ReactECharts option={scatterOption} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 280, width: "100%" }} />
        </article>
      )}
    </section>
  );
}
