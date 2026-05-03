import { useEffect, useMemo, useState } from "react";
import type { Activity } from "../types";
import { useSettingsStore } from "../stores/settingsStore";
import { distanceDivisor, distanceLabel, speedLabel, type DistanceUnit } from "../lib/units";
import { useTranslation } from "../lib/i18n";

type Props = {
  activities: Activity[];
  distanceUnit: DistanceUnit;
  timeFormat: "12h" | "24h";
};

type TableRow = {
  id: number;
  date: Date;
  name: string;
  sport: string;
  durationS: number;
  distanceM: number;
  avgSpeedInUnit: number;
  avgPaceSecPerUnit: number;
  maxHr: number | null;
  avgHr: number | null;
  avgCadence: number | null;
};

const PAGE_SIZE = 10;

function parseActivityMetadata(raw?: string): any {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseUtcDate(input: string): Date {
  const trimmed = input.trim();
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secondsPerUnit: number, unit: DistanceUnit): string {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "-";
  const m = Math.floor(secondsPerUnit / 60);
  const s = Math.floor(secondsPerUnit % 60);
  return `${m}:${String(s).padStart(2, "0")} /${distanceLabel(unit)}`;
}

export function OverviewActivityTable({ activities, distanceUnit, timeFormat }: Props) {
  const overviewTableDays = useSettingsStore((s) => s.overviewTableDays);
  const setOverviewTableDays = useSettingsStore((s) => s.setOverviewTableDays);
  const { t } = useTranslation();

  const [daysInput, setDaysInput] = useState(String(overviewTableDays));
  const [appliedDays, setAppliedDays] = useState(overviewTableDays);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setDaysInput(String(overviewTableDays));
    setAppliedDays(overviewTableDays);
  }, [overviewTableDays]);

  const rows = useMemo<TableRow[]>(() => {
    const since = Date.now() - appliedDays * 24 * 60 * 60 * 1000;
    const divisor = distanceDivisor(distanceUnit);

    return activities
      .map((activity) => {
        const date = parseUtcDate(activity.start_ts_utc);
        if (Number.isNaN(date.getTime()) || date.getTime() < since) return null;

        const avgSpeedInUnit = activity.duration_s > 0 ? (activity.distance_m / divisor) / (activity.duration_s / 3600) : 0;
        const avgPaceSecPerUnit = activity.distance_m > 0 ? activity.duration_s / (activity.distance_m / divisor) : 0;
        
        const parsedMeta = parseActivityMetadata(activity.metadata_json);
        const session = parsedMeta?.session ?? {};
        const maxHr = typeof session.max_heart_rate === "number" ? session.max_heart_rate : null;
        const avgHr = typeof session.avg_heart_rate === "number" ? session.avg_heart_rate : null;
        const avgCadence = typeof session.avg_cadence === "number" ? session.avg_cadence : null;

        return {
          id: activity.id,
          date,
          name: activity.activity_name || activity.file_name,
          sport: activity.sport || "Unknown",
          durationS: activity.duration_s,
          distanceM: activity.distance_m,
          avgSpeedInUnit,
          avgPaceSecPerUnit,
          maxHr,
          avgHr,
          avgCadence,
        };
      })
      .filter((row): row is TableRow => row !== null)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [activities, appliedDays, distanceUnit]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const visiblePageNumbers = useMemo(() => {
    const maxButtons = 7;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(1, currentPage - half);
    let end = Math.min(totalPages, start + maxButtons - 1);
    if (end - start + 1 < maxButtons) {
      start = Math.max(1, end - maxButtons + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function applyDaysFilter() {
    const parsed = Number(daysInput);
    const next = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : overviewTableDays;
    setOverviewTableDays(next);
    setAppliedDays(next);
    setPage(1);
  }

  return (
    <div className="panel overview-activity-table-panel">
      <div className="overview-activity-table-header">
        <h3>{t("table.activitySummary")}</h3>
        <div className="overview-activity-table-days-filter">
          <label htmlFor="overview-last-days">{t("table.last")}</label>
          <input
            id="overview-last-days"
            type="number"
            min={1}
            step={1}
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
          />
          <span>{t("table.days")}</span>
          <button className="btn-secondary" onClick={applyDaysFilter}>{t("table.apply")}</button>
        </div>
      </div>

      <div className="overview-activity-table-wrap">
        <table className="overview-activity-table">
          <thead>
            <tr>
              <th>{t("table.date")}</th>
              <th>{t("table.activity")}</th>
              <th>{t("table.sport")}</th>
              <th>{t("table.duration")}</th>
              <th>{t("table.distance")}</th>
              <th>{t("table.avgPace")}</th>
              <th>{t("table.avgSpeed")}</th>
              <th>{t("table.avgHr")}</th>
              <th>{t("table.maxHr")}</th>
              <th>{t("table.avgCadence")}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td>{row.date.toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: timeFormat === "12h",
                })}</td>
                <td className="overview-activity-table-name">{row.name}</td>
                <td>{row.sport}</td>
                <td>{formatDuration(row.durationS)}</td>
                <td>{(row.distanceM / distanceDivisor(distanceUnit)).toFixed(2)} {distanceLabel(distanceUnit)}</td>
                <td>{formatPace(row.avgPaceSecPerUnit, distanceUnit)}</td>
                <td>{row.avgSpeedInUnit.toFixed(2)} {speedLabel(distanceUnit)}</td>
                <td>{row.avgHr != null ? Math.round(row.avgHr) : "-"}</td>
                <td>{row.maxHr != null ? Math.round(row.maxHr) : "-"}</td>
                <td>{row.avgCadence != null ? Math.round(row.avgCadence) : "-"}</td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={10} className="overview-activity-table-empty">{t("table.noActivitiesInRange")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="overview-activity-table-footer">
        <span>{t("table.activitiesCount", { count: rows.length })}</span>
        <div className="overview-activity-table-pagination">
          <button className="btn-secondary" onClick={() => setPage(1)} disabled={currentPage <= 1}>{t("table.first")}</button>
          <button className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>{t("table.prev")}</button>
          {visiblePageNumbers.map((pageNumber) => (
            <button
              key={`page-${pageNumber}`}
              className={`btn-secondary${pageNumber === currentPage ? " active" : ""}`}
              onClick={() => setPage(pageNumber)}
              disabled={pageNumber === currentPage}
            >
              {pageNumber}
            </button>
          ))}
          <button className="btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>{t("table.next")}</button>
          <button className="btn-secondary" onClick={() => setPage(totalPages)} disabled={currentPage >= totalPages}>{t("table.last_page")}</button>
        </div>
      </div>
    </div>
  );
}
