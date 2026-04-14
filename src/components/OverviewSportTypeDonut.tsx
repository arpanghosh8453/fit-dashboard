import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { Activity } from "../types";

type Props = {
  activities: Activity[];
  theme: "light" | "dark";
};

const COLORS = ["#06b6d4", "#22c55e", "#f59e0b", "#f97316", "#ef4444", "#a855f7", "#3b82f6", "#14b8a6"];

export function OverviewSportTypeDonut({ activities, theme }: Props) {
  const isDark = theme === "dark";
  const axisColor = isDark ? "#a1a1aa" : "#475569";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const activity of activities) {
      const key = (activity.sport || "Unknown").trim() || "Unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], idx) => ({
        name,
        value,
        itemStyle: { color: COLORS[idx % COLORS.length] },
      }));
  }, [activities]);

  const option = {
    tooltip: {
      trigger: "item",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (p: any) => `${p.marker} ${p.name}: <strong>${p.value}</strong> (${p.percent}%)`,
    },
    legend: {
      bottom: 0,
      textStyle: { color: axisColor, fontSize: 12 },
      type: "scroll",
    },
    series: [
      {
        name: "Sports",
        type: "pie",
        radius: ["48%", "74%"],
        center: ["50%", "45%"],
        padAngle: 2,
        itemStyle: {
          borderColor: isDark ? "#0b1220" : "#ffffff",
          borderWidth: 3,
          borderRadius: 8,
        },
        label: { color: axisColor, fontSize: 11, formatter: "{b}: {c}" },
        labelLine: { length: 10, length2: 8 },
        data,
      },
    ],
    graphic: [{
      type: "text",
      left: "center",
      top: "36%",
      style: {
        text: `${activities.length}\nActivities`,
        textAlign: "center",
        fill: axisColor,
        fontSize: 12,
        fontWeight: 600,
      },
    }],
  };

  return (
    <div className="panel overview-sport-donut-panel">
      <h3>Activity Types</h3>
      <ReactECharts option={option} notMerge style={{ height: 240, width: "100%" }} />
    </div>
  );
}
