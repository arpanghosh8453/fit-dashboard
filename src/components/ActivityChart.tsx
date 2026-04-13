import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
};

export function ActivityChart({ records, theme }: Props) {
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

  const seriesData = records.map((r) => [r.timestamp_ms - t0, r.heart_rate ?? null, r.timestamp_ms]);

  const isDark = theme === "dark";
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const lineColor = isDark ? "#22d3ee" : "#0891b2";
  const areaColor = isDark ? "rgba(34, 211, 238, 0.12)" : "rgba(8, 145, 178, 0.1)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const relTime = formatRelTime(p.value[0]);
        const absTime = new Date(p.value[2]).toLocaleTimeString();
        let html = `<div><strong>${relTime}</strong> <span style="color:#888;font-size:10px">(${absTime})</span></div>`;
        for (const s of params) {
          if (s.value[1] !== null) {
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
    grid: { left: 48, right: 16, top: 36, bottom: 46 },
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
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    dataZoom: [
      { type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false },
      { type: "slider", height: 18, borderColor: "transparent", backgroundColor: gridLine, labelFormatter: (val: number) => formatRelTime(val) },
    ],
    series: [
      {
        name: "Heart Rate",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: lineColor, width: 2 },
        areaStyle: { color: areaColor },
        data: seriesData,
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 320, width: "100%" }} />;
}
