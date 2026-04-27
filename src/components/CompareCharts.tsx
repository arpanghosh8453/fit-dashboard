import ReactECharts from "echarts-for-react";
import type { Activity, RecordPoint } from "../types";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { enableChartWheelPageScroll } from "../lib/chartScroll";
import { convertElevationMeters, convertSpeedMps, elevationLabel, speedLabel, type DistanceUnit } from "../lib/units";

type Props = {
  compareIds: number[];
  activities: Activity[];
  theme: "light" | "dark";
  distanceUnit: DistanceUnit;
};

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

const formatLegendDateTime = (rawUtc: string) => {
  const trimmed = rawUtc.trim();
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  const date = new Date(hasZone ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return rawUtc;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function CompareCharts({ compareIds, activities, theme, distanceUnit }: Props) {
  const [loading, setLoading] = useState(false);
  const [dataSets, setDataSets] = useState<{ name: string; records: RecordPoint[] }[]>([]);
  const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchCompareData() {
      if (compareIds.length === 0) {
        setDataSets([]);
        return;
      }
      setLoading(true);
      try {
        const results = await Promise.all(
          compareIds.map(async (id) => {
            const act = activities.find(a => a.id === id);
            const baseName = act?.activity_name || act?.file_name || `Activity ${id}`;
            const dateLabel = act?.start_ts_utc ? formatLegendDateTime(act.start_ts_utc) : `#${id}`;
            const name = `${baseName} — ${dateLabel}`;
            const records = await api.getRecords(id, 45_000).catch(() => []);
            return { name, records };
          })
        );
        if (!cancelled) setDataSets(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchCompareData();
    return () => { cancelled = true; };
  }, [compareIds, activities]);

  if (compareIds.length === 0) {
    return (
      <div className="empty-state">
        <span>Select up to 4 activities from the sidebar using the checkboxes to compare them.</span>
      </div>
    );
  }

  if (loading) {
    return <div className="small" style={{ padding: "2rem 0", textAlign: "center" }}>Loading comparison data...</div>;
  }

  const isDark = theme === "dark";
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const buildSeries = (key: keyof RecordPoint) => {
    return dataSets.map((ds) => {
      const t0 = ds.records[0]?.timestamp_ms ?? 0;
      return {
        name: ds.name,
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        data: ds.records.map((r) => {
          const raw = r[key] ?? null;
          if (raw == null) return [r.timestamp_ms - t0, null];
          if (key === "speed_m_s") return [r.timestamp_ms - t0, convertSpeedMps(raw as number, distanceUnit)];
          if (key === "altitude_m") return [r.timestamp_ms - t0, convertElevationMeters(raw as number, distanceUnit)];
          return [r.timestamp_ms - t0, raw];
        }),
      };
    });
  };

  const createOption = (title: string, yAxisName: string, key: keyof RecordPoint) => ({
    title: {
      text: title,
      textStyle: { color: tooltipText, fontSize: 14, fontWeight: "500" },
      left: 16,
      top: 10,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        if (!params.length) return "";
        const relTime = formatRelTime(params[0].value[0]);
        let html = `<div><strong>${relTime}</strong></div>`;
        for (const s of params) {
          if (s.value[1] !== null) {
            html += `<div>${s.marker} ${s.seriesName}: <strong>${s.value[1]}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: {
      data: dataSets.map(ds => ds.name),
      textStyle: { color: axisColor, fontSize: 11 },
      right: 16,
      top: 10,
    },
    grid: { left: 48, right: 16, top: 40, bottom: 46 },
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
      name: yAxisName,
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    dataZoom: [
      {
        type: "inside",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        moveOnMouseMove: false,
        start: zoomRange?.start ?? 0,
        end: zoomRange?.end ?? 100,
      },
    ],
    series: buildSeries(key),
  });

  const zoomEvents = {
    datazoom: (evt: any) => {
      const batch = evt?.batch?.[0];
      const start = typeof batch?.start === "number" ? batch.start : (typeof evt?.start === "number" ? evt.start : null);
      const end = typeof batch?.end === "number" ? batch.end : (typeof evt?.end === "number" ? evt.end : null);
      if (start !== null && end !== null) {
        setZoomRange({ start, end });
      }
    },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn-secondary" onClick={() => setZoomRange(null)}>
          Reset Zoom
        </button>
      </div>
      <div className="panel"><ReactECharts option={createOption("Heart Rate", "bpm", "heart_rate")} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 320, width: "100%" }} /></div>
      <div className="panel"><ReactECharts option={createOption("Speed", speedLabel(distanceUnit), "speed_m_s")} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 320, width: "100%" }} /></div>
      <div className="panel"><ReactECharts option={createOption("Power", "W", "power")} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 320, width: "100%" }} /></div>
      <div className="panel"><ReactECharts option={createOption("Altitude", elevationLabel(distanceUnit), "altitude_m")} onEvents={zoomEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 320, width: "100%" }} /></div>
    </div>
  );
}
