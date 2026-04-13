import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
};

function safeAvg(values: Array<number | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

export function ActivityInsights({ records, theme }: Props) {
  const isDark = theme === "dark";
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
        <span>Import and select an activity to unlock pace, power, cadence, and effort insights.</span>
      </div>
    );
  }

  const timeline = records.map((r, i) => {
    const prev = i > 0 ? records[i - 1] : undefined;
    const dt = prev ? (r.timestamp_ms - prev.timestamp_ms) / 1000 : 0;
    const derivedSpeed =
      !r.speed_m_s && prev && typeof r.distance_m === "number" && typeof prev.distance_m === "number" && dt > 0
        ? Math.max(0, (r.distance_m - prev.distance_m) / dt)
        : undefined;
    const speedMs = r.speed_m_s ?? derivedSpeed;
    const speedKmh = typeof speedMs === "number" ? speedMs * 3.6 : null;
    const paceMinPerKm = speedKmh && speedKmh > 0 ? 60 / speedKmh : null;
    return [r.timestamp_ms, speedKmh, r.altitude_m ?? null, paceMinPerKm, r.heart_rate ?? null, r.power ?? null];
  });

  const hrValues = records.map((r) => r.heart_rate).filter((n): n is number => typeof n === "number");
  const sortedHr = [...hrValues].sort((a, b) => a - b);
  const hrQ1 = quantile(sortedHr, 0.25);
  const hrQ2 = quantile(sortedHr, 0.5);
  const hrQ3 = quantile(sortedHr, 0.75);

  const zoneBuckets = [0, 0, 0, 0];
  for (const hr of hrValues) {
    if (hr <= hrQ1) zoneBuckets[0] += 1;
    else if (hr <= hrQ2) zoneBuckets[1] += 1;
    else if (hr <= hrQ3) zoneBuckets[2] += 1;
    else zoneBuckets[3] += 1;
  }

  const bucketSize = Math.max(1, Math.floor(records.length / 18));
  const bars = [] as Array<[string, number, number]>;
  for (let i = 0; i < records.length; i += bucketSize) {
    const slice = records.slice(i, i + bucketSize);
    const label = new Date(slice[0].timestamp_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    bars.push([label, safeAvg(slice.map((r) => r.cadence)), safeAvg(slice.map((r) => r.power))]);
  }

  const heatRows = ["HR", "Speed", "Cadence", "Power", "Temp"];
  const heatData: Array<[number, number, number]> = [];
  const heatBins = 24;
  const segment = Math.max(1, Math.floor(records.length / heatBins));

  for (let x = 0; x < heatBins; x += 1) {
    const slice = records.slice(x * segment, (x + 1) * segment);
    const metrics = [
      safeAvg(slice.map((r) => r.heart_rate)),
      safeAvg(slice.map((r) => (r.speed_m_s ? r.speed_m_s * 3.6 : undefined))),
      safeAvg(slice.map((r) => r.cadence)),
      safeAvg(slice.map((r) => r.power)),
      safeAvg(slice.map((r) => r.temperature_c))
    ];
    for (let y = 0; y < metrics.length; y += 1) {
      heatData.push([x, y, Number(metrics[y].toFixed(2))]);
    }
  }

  const timelineOption = {
    tooltip: { trigger: "axis", ...tooltipStyle },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 50, right: 44, top: 42, bottom: 46 },
    xAxis: {
      type: "time",
      axisLabel: { color: axisColor, fontSize: 11 },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: "value", name: "km/h",
        nameTextStyle: { color: axisColor, fontSize: 11 },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: gridLine } },
      },
      {
        type: "value", name: "m",
        nameTextStyle: { color: axisColor, fontSize: 11 },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false },
      { type: "slider", height: 18, borderColor: "transparent", backgroundColor: gridLine },
    ],
    series: [
      {
        name: "Speed", type: "line", smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: "#38bdf8" },
        areaStyle: { color: isDark ? "rgba(56, 189, 248, 0.1)" : "rgba(56, 189, 248, 0.15)" },
        data: timeline.map((d) => [d[0], d[1]]),
      },
      {
        name: "Altitude", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false,
        lineStyle: { width: 1.5, color: "#f97316" },
        data: timeline.map((d) => [d[0], d[2]]),
      },
    ],
  };

  const zoneOption = {
    tooltip: { trigger: "item", ...tooltipStyle },
    legend: { bottom: 0, textStyle: { color: axisColor, fontSize: 12 } },
    series: [
      {
        type: "pie",
        radius: ["38%", "72%"],
        itemStyle: { borderRadius: 8, borderColor: "transparent", borderWidth: 2 },
        label: { color: axisColor, fontSize: 12 },
        data: [
          { name: "Recovery", value: zoneBuckets[0], itemStyle: { color: "#0ea5e9" } },
          { name: "Aerobic", value: zoneBuckets[1], itemStyle: { color: "#10b981" } },
          { name: "Tempo", value: zoneBuckets[2], itemStyle: { color: "#f59e0b" } },
          { name: "Threshold", value: zoneBuckets[3], itemStyle: { color: "#ef4444" } },
        ],
      },
    ],
  };

  const barsOption = {
    tooltip: { trigger: "axis", ...tooltipStyle },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 38, right: 14, top: 44, bottom: 44 },
    xAxis: {
      type: "category",
      axisLabel: { color: axisColor, rotate: 25, interval: 2, fontSize: 11 },
      data: bars.map((b) => b[0]),
    },
    yAxis: [
      {
        type: "value", name: "cad",
        nameTextStyle: { color: axisColor, fontSize: 11 },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: gridLine } },
      },
      {
        type: "value", name: "W",
        nameTextStyle: { color: axisColor, fontSize: 11 },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Cadence", type: "bar", barMaxWidth: 16,
        data: bars.map((b) => Number(b[1].toFixed(1))),
        itemStyle: { color: "#22d3ee", borderRadius: [3, 3, 0, 0] },
      },
      {
        name: "Power", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false,
        data: bars.map((b) => Number(b[2].toFixed(1))),
        lineStyle: { color: "#f97316" },
      },
    ],
  };

  const hrPowerScatter = records
    .filter((r) => typeof r.heart_rate === "number" && typeof r.power === "number")
    .map((r) => [r.heart_rate as number, r.power as number]);

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

  const paceOption = {
    tooltip: { trigger: "axis", ...tooltipStyle },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 56, right: 16, top: 32, bottom: 40 },
    xAxis: {
      type: "time",
      axisLabel: { color: axisColor, fontSize: 11 },
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
    series: [
      {
        name: "Pace", type: "line", smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: "#f43f5e" },
        areaStyle: { color: isDark ? "rgba(244, 63, 94, 0.1)" : "rgba(244, 63, 94, 0.12)" },
        data: timeline.map((d) => [d[0], d[3]]),
      },
    ],
  };

  const heatOption = {
    tooltip: { position: "top", ...tooltipStyle },
    grid: { left: 58, right: 14, top: 16, bottom: 44 },
    xAxis: {
      type: "category",
      data: Array.from({ length: heatBins }, (_, i) => `${i + 1}`),
      axisLabel: { color: axisColor, interval: 3, fontSize: 11 },
    },
    yAxis: {
      type: "category",
      data: heatRows,
      axisLabel: { color: axisColor, fontSize: 11 },
    },
    visualMap: {
      min: 0,
      max: Math.max(...heatData.map((d) => d[2]), 1),
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: axisColor, fontSize: 11 },
      inRange: { color: isDark ? ["#0f172a", "#1d4ed8", "#22d3ee", "#facc15"] : ["#f0f4f8", "#3b82f6", "#06b6d4", "#f59e0b"] },
    },
    series: [
      {
        type: "heatmap",
        data: heatData,
        emphasis: { itemStyle: { borderColor: isDark ? "#fff" : "#0f172a", borderWidth: 1 } },
      },
    ],
  };

  return (
    <section className="insight-grid">
      <article className="panel">
        <h3>Speed + Elevation</h3>
        <ReactECharts option={timelineOption} style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>Pace Trend</h3>
        <ReactECharts option={paceOption} style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>Heart-Rate Zones</h3>
        <ReactECharts option={zoneOption} style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>Cadence & Power</h3>
        <ReactECharts option={barsOption} style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>Effort Heatmap</h3>
        <ReactECharts option={heatOption} style={{ height: 280, width: "100%" }} />
      </article>
      <article className="panel">
        <h3>Power vs Heart Rate</h3>
        <ReactECharts option={scatterOption} style={{ height: 280, width: "100%" }} />
      </article>
    </section>
  );
}
