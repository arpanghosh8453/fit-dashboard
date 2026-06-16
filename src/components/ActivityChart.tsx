import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";
import { enableChartWheelPageScroll } from "../lib/chartScroll";
import { buildHeartRateZones } from "../lib/hrZones";
import { applyRollingAverageSeries, getDynamicSmoothingWindow } from "../lib/chartSmoothing";
import { convertPaceMinPerKm, paceLabel, type DistanceUnit } from "../lib/units";
import {
  buildLapMarkers,
  buildTelemetryPoints,
  buildTelemetryXAxisBounds,
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

export function ActivityChart({
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
  const t0 = records[0]?.timestamp_ms ?? 0;
  const { t } = useTranslation();

  const telemetryPoints = buildTelemetryPoints(records, t0, xAxisMode, distanceUnit, timerMetadata);
  const totalDurationMs = Math.max(0, telemetryPoints[telemetryPoints.length - 1]?.relMs ?? ((records[records.length - 1]?.timestamp_ms ?? t0) - t0));
  const smoothWindow = smoothGraphs ? getDynamicSmoothingWindow(telemetryPoints.length || records.length, totalDurationMs, zoomRange) : 1;
  const xAxisBounds = buildTelemetryXAxisBounds(telemetryPoints);
  const formatTooltipHeader = (relMs: number, distanceMeters: number | null, timestampMs?: number) =>
    formatTelemetryTooltipHeader(xAxisMode, t0, relMs, distanceMeters, distanceUnit, timestampMs);

  const hrZones = buildHeartRateZones(heartRateZoneBoundsBpm);
  const hrSeriesData = telemetryPoints
    .map((point) => [point.x, point.record.heart_rate ?? null, point.relMs, point.timestampMs, point.distanceMeters] as [number | null, number | null, number, number, number | null])
    .filter(isSeriesRow);
  const paceSeriesData = telemetryPoints
    .map((point, i) => {
      const record = point.record;
      const prevPoint = i > 0 ? telemetryPoints[i - 1] : undefined;
      const prevRecord = prevPoint?.record;
      const dtS = prevPoint ? (point.relMs - prevPoint.relMs) / 1000 : 0;
      const derivedSpeed =
        (!record.speed_m_s && prevRecord && typeof record.distance_m === "number" && typeof prevRecord.distance_m === "number" && dtS > 0)
          ? Math.max(0, (record.distance_m - prevRecord.distance_m) / dtS)
          : undefined;
      const speedMs = record.speed_m_s ?? derivedSpeed;
      const paceMinPerKm = speedMs && speedMs > 0 ? 1000 / (speedMs * 60) : null;
      const paceMinPerUnit = paceMinPerKm == null ? null : convertPaceMinPerKm(paceMinPerKm, distanceUnit);
      return [point.x, paceMinPerUnit, point.relMs, point.timestampMs, point.distanceMeters] as [number | null, number | null, number, number, number | null];
    })
    .filter(isSeriesRow);

  const hrSeriesSmoothed = smoothGraphs ? applyRollingAverageSeries(hrSeriesData, 1, smoothWindow) : hrSeriesData;
  const paceSeriesSmoothed = smoothGraphs ? applyRollingAverageSeries(paceSeriesData, 1, smoothWindow) : paceSeriesData;

  const lapMarkers = buildLapMarkers(records, lapTimestampsUtc, t0, xAxisMode, distanceUnit, timerMetadata);

  const isDark = theme === "dark";
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const sharedXAxis = {
    type: "value",
    ...xAxisBounds,
    axisLabel: {
      color: axisColor,
      fontSize: 11,
      formatter: (val: number) => formatTelemetryXAxisTick(val, xAxisMode, distanceUnit),
    },
    axisLine: { lineStyle: { color: gridLine } },
    splitLine: { show: false },
  };

  const hrOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const relTime = Number(p.value[2] ?? 0);
        const distanceMeters = p?.value?.[4] as number | null | undefined;
        let html = formatTooltipHeader(relTime, distanceMeters ?? null, Number(p.value[3] ?? 0));
        for (const s of params) {
          if (s.value[1] !== null && s.value[1] !== undefined) {
            html += `<div>${s.marker} ${s.seriesName}: <strong>${s.value[1]}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: {
      data: [t("chart.heartRate")],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    visualMap: {
      show: false,
      seriesIndex: 0,
      dimension: 1,
      pieces: hrZones.map((zone) => {
        if (zone.maxInclusive === null) {
          return { gt: zone.minExclusive, color: zone.color };
        }
        if (!Number.isFinite(zone.minExclusive)) {
          return { lte: zone.maxInclusive, color: zone.color };
        }
        return { gt: zone.minExclusive, lte: zone.maxInclusive, color: zone.color };
      }),
    },
    grid: { left: 48, right: 16, top: 36, bottom: 38 },
    xAxis: sharedXAxis,
    yAxis: {
      type: "value",
      name: "bpm",
      min: 40,
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
        name: t("chart.heartRate"),
        type: "line",
        smooth: smoothGraphs,
        showSymbol: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.12 },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: hrSeriesSmoothed,
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

  const paceOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const relTime = Number(p.value[2] ?? 0);
        const distanceMeters = p?.value?.[4] as number | null | undefined;
        let html = formatTooltipHeader(relTime, distanceMeters ?? null, Number(p.value[3] ?? 0));
        for (const s of params) {
          if (s.value[1] !== null && s.value[1] !== undefined) {
            const pace = Number(s.value[1]);
            const min = Math.floor(pace);
            const sec = Math.floor((pace - min) * 60);
            html += `<div>${s.marker} ${s.seriesName}: <strong>${min}:${String(sec).padStart(2, "0")} ${paceLabel(distanceUnit)}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: {
      data: [t("chart.pace")],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 38 },
    xAxis: sharedXAxis,
    yAxis: {
      type: "value",
      name: paceLabel(distanceUnit),
      inverse: true,
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
        name: t("chart.pace"),
        type: "line",
        smooth: smoothGraphs,
        showSymbol: false,
        lineStyle: { width: 2, color: "#f43f5e" },
        areaStyle: { color: isDark ? "rgba(244, 63, 94, 0.1)" : "rgba(244, 63, 94, 0.12)" },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: paceSeriesSmoothed,
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

  const onEvents = {
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
    <div style={{ display: "grid", gap: 12, minWidth: 0, width: "100%", overflow: "hidden" }}>
      <ReactECharts option={hrOption} onEvents={onEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 220, width: "100%", minWidth: 0, overflow: "hidden" }} />
      <ReactECharts option={paceOption} onEvents={onEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 220, width: "100%", minWidth: 0, overflow: "hidden" }} />
    </div>
  );
}
