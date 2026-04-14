import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";
import { enableChartWheelPageScroll } from "../lib/chartScroll";
import { HEART_RATE_ZONES } from "../lib/hrZones";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
  zoomRange?: { start: number; end: number } | null;
  onZoomChange?: (range: { start: number; end: number }) => void;
  lapTimestampsUtc?: string[];
};

export function ActivityChart({ records, theme, zoomRange, onZoomChange, lapTimestampsUtc = [] }: Props) {
  const t0 = records[0]?.timestamp_ms ?? 0;
  
  // Format MM:SS or HH:MM:SS
  const formatRelTime = (ms: number) => {
    const totalSec = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const hrSeriesData = records.map((r) => [r.timestamp_ms - t0, r.heart_rate ?? null, r.timestamp_ms]);
  const paceSeriesData = records.map((r, i) => {
    const relMs = r.timestamp_ms - t0;
    const prev = i > 0 ? records[i - 1] : undefined;
    const dtS = prev ? (r.timestamp_ms - prev.timestamp_ms) / 1000 : 0;
    const derivedSpeed =
      (!r.speed_m_s && prev && typeof r.distance_m === "number" && typeof prev.distance_m === "number" && dtS > 0)
        ? Math.max(0, (r.distance_m - prev.distance_m) / dtS)
        : undefined;
    const speedMs = r.speed_m_s ?? derivedSpeed;
    const paceMinPerKm = speedMs && speedMs > 0 ? 1000 / (speedMs * 60) : null;
    return [relMs, paceMinPerKm, r.timestamp_ms];
  });

  const lapMarkers = lapTimestampsUtc
    .slice(1)
    .map((ts, idx) => {
      const parsed = Date.parse(ts);
      if (!Number.isFinite(parsed)) return null;
      const relMs = parsed - t0;
      if (relMs < 0) return null;
      return { xAxis: relMs, name: `Lap ${idx + 1}` };
    })
    .filter((m): m is { xAxis: number; name: string } => m !== null);

  const isDark = theme === "dark";
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const hrOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const relTime = formatRelTime(p.value[0]);
        let html = `<div><strong>${relTime}</strong></div>`;
        for (const s of params) {
          if (s.value[1] !== null && s.value[1] !== undefined) {
            html += `<div>${s.marker} ${s.seriesName}: <strong>${s.value[1]}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: {
      data: ["Heart Rate"],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    visualMap: {
      show: false,
      seriesIndex: 0,
      dimension: 1,
      pieces: HEART_RATE_ZONES.map((zone) => {
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
    xAxis: {
      type: "value",
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        formatter: (val: number) => formatRelTime(val)
      },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
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
        name: "Heart Rate",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.12 },
        data: hrSeriesData,
        markLine: lapMarkers.length ? {
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
        const relTime = formatRelTime(p.value[0]);
        let html = `<div><strong>${relTime}</strong></div>`;
        for (const s of params) {
          if (s.value[1] !== null && s.value[1] !== undefined) {
            const pace = Number(s.value[1]);
            const min = Math.floor(pace);
            const sec = Math.floor((pace - min) * 60);
            html += `<div>${s.marker} ${s.seriesName}: <strong>${min}:${String(sec).padStart(2, "0")} min/km</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: {
      data: ["Pace"],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 38 },
    xAxis: {
      type: "value",
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        formatter: (val: number) => formatRelTime(val)
      },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "min/km",
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
        name: "Pace",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#f43f5e" },
        areaStyle: { color: isDark ? "rgba(244, 63, 94, 0.1)" : "rgba(244, 63, 94, 0.12)" },
        data: paceSeriesData,
        markLine: lapMarkers.length ? {
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
    <div style={{ display: "grid", gap: 12 }}>
      <ReactECharts option={hrOption} onEvents={onEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 220, width: "100%" }} />
      <ReactECharts option={paceOption} onEvents={onEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 220, width: "100%" }} />
    </div>
  );
}
