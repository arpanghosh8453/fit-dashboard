import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
  zoomRange?: { start: number; end: number } | null;
  onZoomChange?: (range: { start: number; end: number }) => void;
  lapTimestampsUtc?: string[];
};

function safeAvg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function formatRelTime(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ActivityInsights({ records, theme, zoomRange, onZoomChange, lapTimestampsUtc = [] }: Props) {
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

  const t0 = records[0]?.timestamp_ms ?? 0;
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
    return {
      relMs: r.timestamp_ms - t0,
      speedKmh,
      altitudeM: r.altitude_m ?? null,
      paceMinPerKm,
      heartRate: r.heart_rate ?? null,
      power: r.power ?? null,
      cadence: r.cadence ?? null,
      temperatureC: r.temperature_c ?? null,
      timestampMs: r.timestamp_ms,
    };
  });

  const hasPowerData = records.some((r) => typeof r.power === "number" && r.power > 0);
  const hasHeartRateData = records.some((r) => typeof r.heart_rate === "number" && r.heart_rate > 0);

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

  const hrValues = records
    .map((r) => r.heart_rate)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const maxHrObserved = hrValues.length ? Math.max(...hrValues) : 0;

  const zoneMinutes = [0, 0, 0, 0, 0];
  if (maxHrObserved > 0) {
    for (let i = 0; i < records.length - 1; i += 1) {
      const hr = records[i].heart_rate;
      if (typeof hr !== "number" || hr <= 0) continue;
      const dtMin = Math.max(0, (records[i + 1].timestamp_ms - records[i].timestamp_ms) / 60000);
      const ratio = hr / maxHrObserved;
      if (ratio < 0.6) zoneMinutes[0] += dtMin;
      else if (ratio < 0.7) zoneMinutes[1] += dtMin;
      else if (ratio < 0.8) zoneMinutes[2] += dtMin;
      else if (ratio < 0.9) zoneMinutes[3] += dtMin;
      else zoneMinutes[4] += dtMin;
    }
  }

  const timelineOption = {
    tooltip: {
      trigger: "axis",
      ...tooltipStyle,
      formatter: (params: any[]) => {
        const p = params?.[0];
        const rel = p?.value?.[0] ?? 0;
        let html = `<div><strong>${formatRelTime(rel)}</strong></div>`;
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
    xAxis: {
      type: "value",
      axisLabel: { color: axisColor, fontSize: 11, formatter: (val: number) => formatRelTime(val) },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value", name: "km/h",
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
        name: "Speed", type: "line", smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: "#38bdf8" },
        areaStyle: { color: isDark ? "rgba(56, 189, 248, 0.1)" : "rgba(56, 189, 248, 0.15)" },
        data: timeline.map((d) => [d.relMs, d.speedKmh]),
        markLine: lapMarkers.length ? {
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
        const rel = p?.value?.[0] ?? 0;
        const val = p?.value?.[1];
        return `<div><strong>${formatRelTime(rel)}</strong></div><div>${p?.marker ?? ""} Elevation: <strong>${val == null ? "--" : Number(val).toFixed(2)} m</strong></div>`;
      }
    },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 50, right: 16, top: 42, bottom: 46 },
    xAxis: {
      type: "value",
      axisLabel: { color: axisColor, fontSize: 11, formatter: (val: number) => formatRelTime(val) },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value", name: "m",
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
        name: "Elevation", type: "line", smooth: true, showSymbol: false,
        lineStyle: { width: 1.5, color: "#f97316" },
        data: timeline.map((d) => [d.relMs, d.altitudeM]),
        markLine: lapMarkers.length ? {
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
        itemStyle: { borderRadius: 8, borderColor: "transparent", borderWidth: 2 },
        label: { color: axisColor, fontSize: 12, formatter: (p: any) => `${p.name}\n${Number(p.value).toFixed(1)} min` },
        data: [
          { name: "Z1 <60%", value: zoneMinutes[0], itemStyle: { color: "#38bdf8" } },
          { name: "Z2 60-70%", value: zoneMinutes[1], itemStyle: { color: "#22c55e" } },
          { name: "Z3 70-80%", value: zoneMinutes[2], itemStyle: { color: "#f59e0b" } },
          { name: "Z4 80-90%", value: zoneMinutes[3], itemStyle: { color: "#f97316" } },
          { name: "Z5 >90%", value: zoneMinutes[4], itemStyle: { color: "#ef4444" } },
        ],
      },
    ],
  };

  const cadenceOption = {
    tooltip: {
      trigger: "axis",
      ...tooltipStyle,
      formatter: (params: any[]) => {
        const p = params?.[0];
        const rel = p?.value?.[0] ?? 0;
        let html = `<div><strong>${formatRelTime(rel)}</strong></div>`;
        for (const row of params) {
          if (row.value?.[1] !== null && row.value?.[1] !== undefined) {
            const unit = row.seriesName === "Cadence" ? " rpm" : " W";
            html += `<div>${row.marker} ${row.seriesName}: <strong>${Number(row.value[1]).toFixed(2)}${unit}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: { textStyle: { color: axisColor, fontSize: 12 }, top: 0 },
    grid: { left: 44, right: hasPowerData ? 44 : 16, top: 44, bottom: 44 },
    xAxis: {
      type: "value",
      axisLabel: { color: axisColor, fontSize: 11, formatter: (val: number) => formatRelTime(val) },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
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
        name: "Cadence", type: "line", smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: "#22d3ee" },
        data: timeline.map((d) => [d.relMs, d.cadence]),
        markLine: lapMarkers.length ? {
          symbol: ["none", "none"],
          lineStyle: { color: isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)", type: "dashed", width: 1 },
          label: { color: axisColor, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: lapMarkers,
        } : undefined,
      },
      ...(hasPowerData ? [{
        name: "Power", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false,
        data: timeline.map((d) => [d.relMs, d.power]),
        lineStyle: { color: "#f97316" },
      }] : []),
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

  const totalRelMs = Math.max(0, (records[records.length - 1]?.timestamp_ms ?? t0) - t0);
  const heatBins = Math.max(1, Math.ceil(totalRelMs / 60000));
  const heatRows = hasPowerData ? ["HR", "Speed", "Cadence", "Power", "Temp"] : ["HR", "Speed", "Cadence", "Temp"];
  const heatData: Array<[number, number, number]> = [];

  for (let x = 0; x < heatBins; x += 1) {
    const startMs = x * 60000;
    const endMs = startMs + 60000;
    const slice = timeline.filter((d) => d.relMs >= startMs && d.relMs < endMs);
    const metrics = hasPowerData
      ? [
          safeAvg(slice.map((r) => r.heartRate)),
          safeAvg(slice.map((r) => r.speedKmh)),
          safeAvg(slice.map((r) => r.cadence)),
          safeAvg(slice.map((r) => r.power)),
          safeAvg(slice.map((r) => r.temperatureC)),
        ]
      : [
          safeAvg(slice.map((r) => r.heartRate)),
          safeAvg(slice.map((r) => r.speedKmh)),
          safeAvg(slice.map((r) => r.cadence)),
          safeAvg(slice.map((r) => r.temperatureC)),
        ];

    for (let y = 0; y < metrics.length; y += 1) {
      heatData.push([x, y, Number((metrics[y] ?? 0).toFixed(2))]);
    }
  }

  const heatOption = {
    tooltip: {
      position: "top",
      ...tooltipStyle,
      formatter: (p: any) => {
        const minuteIdx = Number(p.value[0]);
        const rowIdx = Number(p.value[1]);
        const value = Number(p.value[2]);
        const startMs = minuteIdx * 60000;
        const endMs = (minuteIdx + 1) * 60000;
        return `<div><strong>${heatRows[rowIdx]}</strong></div><div>${formatRelTime(startMs)} - ${formatRelTime(endMs)}: <strong>${value.toFixed(2)}</strong></div>`;
      },
    },
    grid: { left: 58, right: 14, top: 16, bottom: 44 },
    xAxis: {
      type: "category",
      data: Array.from({ length: heatBins }, (_, i) => formatRelTime(i * 60000)),
      axisLabel: {
        color: axisColor,
        interval: Math.max(0, Math.floor(heatBins / 14)),
        fontSize: 11,
      },
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
        <h3>Speed Trend</h3>
        <ReactECharts option={timelineOption} onEvents={zoomEvents} notMerge style={{ height: 280, width: "100%" }} />
      </article>
      {hasPowerData && hasHeartRateData && (
        <article className="panel">
          <h3>Heart Rate Zone Time</h3>
          <ReactECharts option={zoneOption} notMerge style={{ height: 280, width: "100%" }} />
        </article>
      )}
      <article className="panel">
        <h3>{hasPowerData ? "Cadence & Power" : "Cadence"}</h3>
        <ReactECharts option={cadenceOption} onEvents={zoomEvents} notMerge style={{ height: 280, width: "100%" }} />
      </article>
      <div className="insight-pair-row">
        <article className="panel">
          <h3>Effort Heatmap</h3>
          <ReactECharts option={heatOption} notMerge style={{ height: 280, width: "100%" }} />
        </article>
        <article className="panel">
          <h3>Elevation</h3>
          <ReactECharts option={elevationOption} onEvents={zoomEvents} notMerge style={{ height: 280, width: "100%" }} />
        </article>
      </div>
      {hasPowerData && hasHeartRateData && (
        <article className="panel">
          <h3>Power vs Heart Rate</h3>
          <ReactECharts option={scatterOption} notMerge style={{ height: 280, width: "100%" }} />
        </article>
      )}
    </section>
  );
}
