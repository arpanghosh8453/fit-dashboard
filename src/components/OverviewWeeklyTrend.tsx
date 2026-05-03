import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { Activity } from "../types";
import { useTranslation } from "../lib/i18n";

type Props = {
  activities: Activity[];
  distanceUnit: "km" | "mi";
  theme: "light" | "dark";
};

type WeekBucket = {
  label: string;
  distance: number;
  durationHours: number;
};

function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function OverviewWeeklyTrend({ activities, distanceUnit, theme }: Props) {
  const isDark = theme === "dark";
  const { t } = useTranslation();
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const buckets = useMemo<WeekBucket[]>(() => {
    const divisor = distanceUnit === "km" ? 1000 : 1609.344;
    const map = new Map<string, { start: Date; distance: number; durationHours: number }>();

    for (const activity of activities) {
      const ts = new Date(activity.start_ts_utc);
      if (Number.isNaN(ts.getTime())) continue;
      const wk = weekStart(ts);
      const key = wk.toISOString();
      const existing = map.get(key) ?? { start: wk, distance: 0, durationHours: 0 };
      existing.distance += activity.distance_m / divisor;
      existing.durationHours += activity.duration_s / 3600;
      map.set(key, existing);
    }

    return Array.from(map.values())
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(-24)
      .map((w) => ({
        label: w.start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        distance: Number(w.distance.toFixed(2)),
        durationHours: Number(w.durationHours.toFixed(2)),
      }));
  }, [activities, distanceUnit]);

  const option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
    },
    legend: {
      data: [t("trend.distance"), t("trend.duration")],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    grid: { left: 52, right: 52, top: 42, bottom: 46 },
    xAxis: {
      type: "category",
      data: buckets.map((b) => b.label),
      axisLabel: { color: axisColor, fontSize: 11, rotate: 30 },
      axisLine: { lineStyle: { color: gridLine } },
    },
    yAxis: [
      {
        type: "value",
        name: distanceUnit,
        axisLabel: { color: axisColor, fontSize: 11 },
        nameTextStyle: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: gridLine } },
      },
      {
        type: "value",
        name: "h",
        axisLabel: { color: axisColor, fontSize: 11 },
        nameTextStyle: { color: axisColor, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t("trend.distance"),
        type: "bar",
        barMaxWidth: 18,
        itemStyle: { color: "#06b6d4", borderRadius: [4, 4, 0, 0] },
        data: buckets.map((b) => b.distance),
      },
      {
        name: t("trend.duration"),
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#f59e0b" },
        data: buckets.map((b) => b.durationHours),
      },
    ],
  };

  return (
    <div className="panel overview-weekly-trend-panel">
      <h3>{t("trend.weeklyTrainingTrend")}</h3>
      <div className="overview-weekly-trend-chart">
        <ReactECharts option={option} notMerge style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
