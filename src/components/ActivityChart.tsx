import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
};

export function ActivityChart({ records, theme }: Props) {
  const seriesData = records.map((r) => [r.timestamp_ms, r.heart_rate ?? null]);

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
    },
    legend: {
      data: ["Heart Rate"],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 46 },
    xAxis: {
      type: "time",
      axisLabel: { color: axisColor, fontSize: 11 },
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
      { type: "slider", height: 18, borderColor: "transparent", backgroundColor: gridLine },
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
