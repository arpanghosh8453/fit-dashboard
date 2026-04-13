import { useMemo } from "react";
import type { Activity } from "../types";

type Props = {
  activities: Activity[];
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function ActivityContributionHeatmap({ activities }: Props) {
  const { weeks, counts, maxCount, startDate, endDate } = useMemo(() => {
    const today = startOfDay(new Date());
    const rangeStart = addDays(today, -364);

    const countMap = new Map<string, number>();
    for (const a of activities) {
      const dt = new Date(a.start_ts_utc);
      if (Number.isNaN(dt.getTime())) continue;
      const key = toDateKey(startOfDay(dt));
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    const gridStart = addDays(rangeStart, -rangeStart.getDay());
    const gridEnd = addDays(today, 6 - today.getDay());

    const days: Date[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      days.push(new Date(d));
    }

    const weekChunks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weekChunks.push(days.slice(i, i + 7));
    }

    let peak = 0;
    for (const value of countMap.values()) {
      if (value > peak) peak = value;
    }

    return {
      weeks: weekChunks,
      counts: countMap,
      maxCount: peak,
      startDate: rangeStart,
      endDate: today,
    };
  }, [activities]);

  const cellColor = (count: number): string => {
    if (count <= 0) return "rgba(148, 163, 184, 0.20)";
    const ratio = maxCount > 0 ? count / maxCount : 0;
    if (ratio < 0.25) return "#155e75";
    if (ratio < 0.5) return "#0891b2";
    if (ratio < 0.75) return "#06b6d4";
    return "#22d3ee";
  };

  const rangeLabel = `${startDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} - ${endDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

  return (
    <div className="panel">
      <div className="overview-heatmap-head">
        <h3>Activity Contributions</h3>
        <span className="small">{rangeLabel}</span>
      </div>
      <div className="overview-heatmap-wrap">
        <div className="overview-heatmap-grid">
          <div className="overview-heatmap-months">
            {weeks.map((week, i) => {
              const d = week[0];
              const showMonth = d.getDate() <= 7;
              return (
                <div key={i} className="overview-heatmap-month">
                  {showMonth ? d.toLocaleDateString("en-US", { month: "short" }) : ""}
                </div>
              );
            })}
          </div>

          <div className="overview-heatmap-body">
            <div className="overview-heatmap-daylabels">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
            <div className="overview-heatmap-weeks">
              {weeks.map((week, wi) => (
                <div key={wi} className="overview-heatmap-week">
                  {week.map((d) => {
                    const key = toDateKey(d);
                    const count = counts.get(key) ?? 0;
                    return (
                      <div
                        key={key}
                        className="overview-heatmap-cell"
                        title={`${d.toDateString()} - ${count} activit${count === 1 ? "y" : "ies"}`}
                        style={{ backgroundColor: cellColor(count) }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="overview-heatmap-legend small">
        <span>Less</span>
        <div className="overview-heatmap-cell" style={{ backgroundColor: "rgba(148, 163, 184, 0.20)" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#155e75" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#0891b2" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#06b6d4" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#22d3ee" }} />
        <span>More</span>
      </div>
    </div>
  );
}
