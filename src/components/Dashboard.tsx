import { DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useActivityStore } from "../stores/activityStore";
import { ActivityChart } from "./ActivityChart";
import { ActivityMap } from "./ActivityMap";
import { CompareCharts } from "./CompareCharts";
import { ActivityInsights } from "./ActivityInsights";
import { ActivityContributionHeatmap } from "./ActivityContributionHeatmap";
import { OverviewLocationMap } from "./OverviewLocationMap";
import { OverviewSportTypeDonut } from "./OverviewSportTypeDonut";
import { OverviewWeeklyTrend } from "./OverviewWeeklyTrend";
import { DatePickerPopover } from "./DatePickerPopover";
import { DateRange } from "react-day-picker";
import { DonationBanner } from "./DonationBanner";
import { SettingsPanel } from "./SettingsPanel";
import { api } from "../lib/api";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exportSingleActivity, exportBulkActivities, type ExportFormat, type BulkExportProgress } from "../lib/exportUtils";
import { useSettingsStore } from "../stores/settingsStore";
import type { Activity, RecordPoint } from "../types";
import appIcon from "../assets/app-icon.svg";

type Props = { onLogout: () => Promise<void> };

type VersionBadgeStatus = {
  state: "hidden" | "latest" | "update";
  latestVersion: string | null;
};

type ActivityMetadata = {
  file_id?: {
    product_name?: string | null;
    serial_number?: number | null;
  };
  activity_metrics?: {
    vo2_max?: number | null;
  };
  session?: {
    beginning_body_battery?: number | null;
    ending_body_battery?: number | null;
    max_heart_rate?: number | null;
    avg_heart_rate?: number | null;
    max_cadence?: number | null;
    avg_cadence?: number | null;
    total_elapsed_time_s?: number | null;
    total_distance_m?: number | null;
  };
  laps?: Array<{
    start_ts_utc?: string | null;
    end_ts_utc?: string | null;
  }>;
};

/* ── Helpers ─────────────────────────────────────────────────────── */

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDurationShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPace(secondsPerUnit: number, unit: string): string {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "-";
  const min = Math.floor(secondsPerUnit / 60);
  const sec = Math.floor(secondsPerUnit % 60);
  return `${min}:${String(sec).padStart(2, "0")} /${unit}`;
}

function shortenFileName(name: string, maxLength = 45): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength)}...`;
}

function parseActivityMetadata(raw?: string): ActivityMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActivityMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isTauriRuntime(): boolean {
  return isTauri();
}

function normalizeSemver(value: string): string | null {
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+)$/i);
  return match ? match[1] : null;
}

function computeRecordStats(records: RecordPoint[]) {
  let maxSpeed = 0, totalSpeed = 0, speedCount = 0;
  let maxHr = 0, totalHr = 0, hrCount = 0;
  let maxAlt = -Infinity;
  let maxPower = 0, totalPower = 0, powerCount = 0;

  for (const r of records) {
    if (typeof r.speed_m_s === "number") {
      const kmh = r.speed_m_s * 3.6;
      totalSpeed += kmh; speedCount++;
      if (kmh > maxSpeed) maxSpeed = kmh;
    }
    if (typeof r.heart_rate === "number") {
      totalHr += r.heart_rate; hrCount++;
      if (r.heart_rate > maxHr) maxHr = r.heart_rate;
    }
    if (typeof r.altitude_m === "number" && r.altitude_m > maxAlt) maxAlt = r.altitude_m;
    if (typeof r.power === "number") {
      totalPower += r.power; powerCount++;
      if (r.power > maxPower) maxPower = r.power;
    }
  }

  return {
    avgSpeed: speedCount > 0 ? totalSpeed / speedCount : 0,
    maxSpeed,
    avgHr: hrCount > 0 ? totalHr / hrCount : 0,
    maxHr,
    maxAlt: maxAlt === -Infinity ? 0 : maxAlt,
    avgPower: powerCount > 0 ? totalPower / powerCount : 0,
    maxPower,
  };
}

/* ── SVG Icons ───────────────────────────────────────────────────── */

const svgProps = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconActivity() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>;
}
function IconDistance() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
}
function IconClock() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
}
function IconSport() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
}
function IconSpeed() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M13 2L4 14h7l-1 8 10-12h-7l1-8z" /></svg>;
}
function IconHeart() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>;
}
function IconMountain() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="m8 3 4 8 5-5 5 15H2L8 3z" /></svg>;
}
function IconDevice() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18" /></svg>;
}
function IconAvg() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><line x1="4" y1="20" x2="20" y2="4" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
}
function IconSearch() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}
function IconSort() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><line x1="6" y1="7" x2="18" y2="7" /><line x1="9" y1="12" x2="18" y2="12" /><line x1="12" y1="17" x2="18" y2="17" /></svg>;
}
function IconSortDirection({ direction }: { direction: "asc" | "desc" }) {
  return direction === "asc"
    ? <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="7 11 12 6 17 11" /><line x1="12" y1="18" x2="12" y2="7" /></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="7 13 12 18 17 13" /><line x1="12" y1="6" x2="12" y2="17" /></svg>;
}
function IconMenu() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>;
}
function IconSun() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>;
}
function IconMoon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>;
}
function IconSettings() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
}
function IconLogout() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
}
function IconRefresh() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>;
}
function IconChevron() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
function IconCollapse() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>;
}
function IconExpand() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>;
}
function IconPower() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M18.36 6.64a9 9 0 11-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>;
}
function IconEdit() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
function IconTrash() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>;
}
function IconCheck() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="20 6 9 17 4 12" /></svg>;
}
function IconX() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}
function IconDownload() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}
function IconFile() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}
function IconBarChart({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
}
function IconClipboard() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>;
}

/* ── Dashboard Component ─────────────────────────────────────────── */

export function Dashboard({ onLogout }: Props) {
  const [tab, setTab] = useState<"overview" | "individual" | "compare">("overview");
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<BulkExportProgress | null>(null);
  const [contextExportOpen, setContextExportOpen] = useState(false);
  const [bulkExportDropdownOpen, setBulkExportDropdownOpen] = useState(false);

  // Bulk delete state
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(true);
  const [minDurationMinutes, setMinDurationMinutes] = useState("");
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [datePickerFromOpen, setDatePickerFromOpen] = useState(false);
  const [datePickerToOpen, setDatePickerToOpen] = useState(false);
  const dateFromBtnRef = useRef<HTMLButtonElement>(null);
  const dateToBtnRef = useRef<HTMLButtonElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    completed: number;
    total: number;
    current?: string;
    currentIndex?: number;
    status: "processing" | "refreshing";
  } | null>(null);
  const [forceBrowserPicker, setForceBrowserPicker] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "name" | "duration">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; activityId: number; activityName: string;
  } | null>(null);
  const [telemetryZoom, setTelemetryZoom] = useState<{ start: number; end: number } | null>(null);
  const [smoothGraphs, setSmoothGraphs] = useState(true);
  const [appVersion, setAppVersion] = useState("unknown");
  const [versionBadgeStatus, setVersionBadgeStatus] = useState<VersionBadgeStatus>({ state: "hidden", latestVersion: null });

  // Inline rename/delete state
  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    activities, selectedActivity, records, overview,
    filterSport, setFilterSport, selectActivity, refresh
  } = useActivityStore();
  const {
    distanceUnit, timeFormat, supporterBadge,
    toggleSettings, setTheme, mapStyle, setMapStyle,
    loadSupporterStatus, theme,
  } = useSettingsStore();

  useEffect(() => {
    const close = () => { setContextMenu(null); setBulkExportDropdownOpen(false); setIsSortOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolveCurrentVersion = async (): Promise<string> => {
      const fallbackVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";
      try {
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          const { getVersion } = await import("@tauri-apps/api/app");
          const version = await getVersion();
          return version || fallbackVersion;
        }
      } catch {
        // Ignore and continue with fallback for web mode or API failures.
      }
      return fallbackVersion;
    };

    const loadVersionStatus = async () => {
      const current = await resolveCurrentVersion();
      if (cancelled) return;
      setAppVersion(current);

      try {
        const response = await fetch("https://api.github.com/repos/arpanghosh8453/fit-dashboard/releases/latest", {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) throw new Error(`GitHub status ${response.status}`);

        const payload = (await response.json()) as { tag_name?: string };
        const latest = normalizeSemver(payload.tag_name ?? "");
        const currentNormalized = normalizeSemver(current);
        if (!latest || !currentNormalized) {
          if (!cancelled) {
            setVersionBadgeStatus({ state: "hidden", latestVersion: null });
          }
          return;
        }

        if (!cancelled) {
          setVersionBadgeStatus({
            state: latest === currentNormalized ? "latest" : "update",
            latestVersion: latest,
          });
        }
      } catch {
        if (!cancelled) {
          setVersionBadgeStatus({ state: "hidden", latestVersion: null });
        }
      }
    };

    void loadVersionStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadSupporterStatus();
  }, []);

  function parseUtcDate(input: string): Date {
    const trimmed = input.trim();
    const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
    return new Date(hasZone ? normalized : `${normalized}Z`);
  }

  const filtered = useMemo(() => {
    const minSec = minDurationMinutes ? Number(minDurationMinutes) * 60 : null;
    const maxSec = maxDurationMinutes ? Number(maxDurationMinutes) * 60 : null;
    const fromTs = dateFrom ? dateFrom.getTime() : null;
    const toTs = dateTo ? (dateTo.getTime() + 86399999) : null;

    return activities.filter((a) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!`${a.activity_name} ${a.file_name} ${a.sport}`.toLowerCase().includes(q)) return false;
      }
      if (filterSport !== "all" && a.sport !== filterSport) return false;
      const ts = parseUtcDate(a.start_ts_utc).getTime();
      if (Number.isFinite(ts)) {
        if (fromTs !== null && ts < fromTs) return false;
        if (toTs !== null && ts > toTs) return false;
      }
      if (minSec !== null && Number.isFinite(minSec) && a.duration_s < minSec) return false;
      if (maxSec !== null && Number.isFinite(maxSec) && a.duration_s > maxSec) return false;
      return true;
    });
  }, [activities, filterSport, minDurationMinutes, maxDurationMinutes, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    const allowed = new Set(filtered.map((a) => a.id));
    setCompareIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filtered]);

  const sortedForList = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sortBy === "name") {
        const cmp = (a.activity_name || a.file_name).localeCompare(b.activity_name || b.file_name, undefined, { sensitivity: "base" });
        return sortDirection === "asc" ? cmp : -cmp;
      }
      if (sortBy === "duration") {
        return sortDirection === "asc" ? a.duration_s - b.duration_s : b.duration_s - a.duration_s;
      }
      const aTs = parseUtcDate(a.start_ts_utc).getTime();
      const bTs = parseUtcDate(b.start_ts_utc).getTime();
      const aSafe = Number.isFinite(aTs) ? aTs : 0;
      const bSafe = Number.isFinite(bTs) ? bTs : 0;
      return sortDirection === "asc" ? aSafe - bSafe : bSafe - aSafe;
    });
    return list;
  }, [filtered, sortBy, sortDirection]);

  const overviewRecords = useMemo(() => {
    if (tab !== "overview") return [];
    return filtered
      .filter((a) => typeof a.start_latitude === "number" && typeof a.start_longitude === "number")
      .map((a) => {
        const ts = parseUtcDate(a.start_ts_utc).getTime();
        return {
          timestamp_ms: Number.isFinite(ts) ? ts : 0,
          latitude: a.start_latitude,
          longitude: a.start_longitude,
        } as RecordPoint;
      });
  }, [tab, filtered]);

  const sports = Array.from(new Set(activities.map((a) => a.sport).filter(Boolean)));
  const filteredSports = Array.from(new Set(filtered.map((a) => a.sport).filter(Boolean)));
  const filteredDevices = Array.from(new Set(filtered.map((a) => a.device).filter(Boolean)));
  const selectedRecords = tab === "overview" ? overviewRecords : records;
  const distanceDivisor = distanceUnit === "km" ? 1000 : 1609.344;
  const distanceSuffix = distanceUnit;
  const filteredTotalDistanceM = filtered.reduce((sum, a) => sum + a.distance_m, 0);
  const filteredTotalDurationS = filtered.reduce((sum, a) => sum + a.duration_s, 0);
  const totalDistance = filteredTotalDistanceM / distanceDivisor;
  const totalDuration = filteredTotalDurationS;
  const avgDistance = filtered.length ? totalDistance / filtered.length : 0;
  const avgDuration = filtered.length ? totalDuration / filtered.length : 0;
  const recordStats = useMemo(() => computeRecordStats(records), [records]);

  function formatDate(input: string): string {
    const date = parseUtcDate(input);
    if (Number.isNaN(date.getTime())) return input;
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/^(\d{2}\s+[A-Za-z]{3})\s+(\d{4})$/, "$1, $2");
  }

  function formatDateShort(input: string): string {
    const date = parseUtcDate(input);
    if (Number.isNaN(date.getTime())) return input;
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/^(\d{2}\s+[A-Za-z]{3})\s+(\d{4})$/, "$1, $2");
  }

  function formatTimeShort(input: string): string {
    const date = parseUtcDate(input);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: timeFormat === "12h" });
  }

  async function waitForUiPaint() {
    // Two RAF ticks ensure at least one paint happens before heavy async work starts.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  function pushImportProgress(
    progress: {
      completed: number;
      total: number;
      current?: string;
      currentIndex?: number;
      status: "processing" | "refreshing";
    },
    message?: string,
  ) {
    flushSync(() => {
      setImportProgress(progress);
      if (message) setImportMessage(message);
    });
  }

  function startImportProgress(total: number) {
    flushSync(() => {
      setIsImporting(true);
      setIsImportOpen(true);
      setImportProgress({ completed: 0, total, current: "Preparing queue...", status: "processing" });
      setImportMessage(`Processing 0/${total}`);
    });
  }

  async function importFromPaths(paths: string[]) {
    if (!paths.length || isImporting || isSyncing) return;
    const validPaths = paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower.endsWith(".fit") || lower.endsWith(".tcx") || lower.endsWith(".gpx");
    });
    if (!validPaths.length) {
      setImportMessage("No supported files selected (.fit, .tcx, .gpx).");
      return;
    }

    startImportProgress(validPaths.length);
    await waitForUiPaint();
    let imported = 0, duplicates = 0, skipped = 0, failed = 0;
    let refreshError: string | null = null;
    for (let i = 0; i < validPaths.length; i++) {
      const path = validPaths[i];
      const fileName = path.split(/[\\/]/).pop() ?? path;
      const fileNameDisplay = shortenFileName(fileName);
      pushImportProgress(
        { completed: i, total: validPaths.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processing ${i + 1}/${validPaths.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
      try {
        const result: any = await api.importActivityPath(path);
        if (result?.status === "duplicate") {
          duplicates++;
        } else if (result?.status === "skipped") {
          skipped++;
        } else {
          imported++;
          if (imported % 10 === 0) {
            pushImportProgress(
              {
                completed: i + 1,
                total: validPaths.length,
                current: `Refreshing after ${imported} successful imports...`,
                status: "refreshing",
              },
              `Imported ${imported} files. Refreshing list and stats...`,
            );
            await waitForUiPaint();
            try {
              await refresh();
            } catch (err) {
              if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
            }
            pushImportProgress(
              { completed: i + 1, total: validPaths.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
            );
            await waitForUiPaint();
          }
        }
      } catch (err) {
        failed++;
        setImportMessage(`Failed on ${fileNameDisplay}: ${err instanceof Error ? err.message : "unknown"}`);
      }
      pushImportProgress(
        { completed: i + 1, total: validPaths.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processed ${i + 1}/${validPaths.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
    }

    try {
      pushImportProgress(
        { completed: validPaths.length, total: validPaths.length, current: "Refreshing activity list...", status: "refreshing" },
        "Import queue finished, refreshing activity list...",
      );
      await waitForUiPaint();
      await refresh();
    } catch (err) {
      if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
    }
    setIsImporting(false);
    setImportProgress(null);
    if (refreshError) {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}. Refresh failed: ${refreshError}`);
    } else {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}.`);
    }
  }

  function parseDroppedFileUris(raw: string): string[] {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        if (line.startsWith("file://")) {
          try {
            return decodeURIComponent(line.replace(/^file:\/\//, ""));
          } catch {
            return line.replace(/^file:\/\//, "");
          }
        }
        return line;
      });
  }

  async function handleImportDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (isImporting || isSyncing) return;

    const fileList = e.dataTransfer.files;
    if (fileList && fileList.length > 0) {
      setForceBrowserPicker(false);
      await importBatch(fileList);
      return;
    }

    if (!isTauriRuntime()) {
      setImportMessage("No supported files dropped (.fit, .tcx, .gpx).");
      return;
    }

    const uriList = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!uriList) {
      setImportMessage("No supported files dropped (.fit, .tcx, .gpx).");
      return;
    }
    const paths = parseDroppedFileUris(uriList);
    await importFromPaths(paths);
  }

  async function importBatch(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || isImporting) return;
    const files = Array.from(fileList).filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith(".fit") || name.endsWith(".tcx") || name.endsWith(".gpx");
    });
    if (!files.length) { setImportMessage("No supported files selected (.fit, .tcx, .gpx)."); return; }
    startImportProgress(files.length);
    await waitForUiPaint();
    let imported = 0, duplicates = 0, skipped = 0, failed = 0;
    let refreshError: string | null = null;
    for (let i = 0; i < files.length; i++) {
      const fileNameDisplay = shortenFileName(files[i].name);
      pushImportProgress(
        { completed: i, total: files.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processing ${i + 1}/${files.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
      try {
        const result: any = await api.importFit(files[i]);
        if (result?.status === "duplicate") {
          duplicates++;
        } else if (result?.status === "skipped") {
          skipped++;
        } else {
          imported++;
          if (imported % 10 === 0) {
            pushImportProgress(
              {
                completed: i + 1,
                total: files.length,
                current: `Refreshing after ${imported} successful imports...`,
                status: "refreshing",
              },
              `Imported ${imported} files. Refreshing list and stats...`,
            );
            await waitForUiPaint();
            try {
              await refresh();
            } catch (err) {
              if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
            }
            pushImportProgress(
              { completed: i + 1, total: files.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
            );
            await waitForUiPaint();
          }
        }
      } catch (err) {
        failed++;
        setImportMessage(`Failed on ${fileNameDisplay}: ${err instanceof Error ? err.message : "unknown"}`);
      }
      pushImportProgress(
        { completed: i + 1, total: files.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processed ${i + 1}/${files.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
    }
    try {
      pushImportProgress(
        { completed: files.length, total: files.length, current: "Refreshing activity list...", status: "refreshing" },
        "Import queue finished, refreshing activity list...",
      );
      await waitForUiPaint();
      await refresh();
    } catch (err) {
      if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
    }
    setIsImporting(false);
    setImportProgress(null);
    if (refreshError) {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}. Refresh failed: ${refreshError}`);
    } else {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}.`);
    }
  }

  async function importFromDesktopDialog() {
    if (isImporting || isSyncing) return;
    setForceBrowserPicker(false);
    let picked: string | string[] | null = null;
    try {
      picked = await open({
        multiple: true,
        filters: [
          { name: "Activity logs", extensions: ["fit", "FIT", "tcx", "TCX", "gpx", "GPX"] },
          { name: "FIT", extensions: ["fit", "FIT"] },
          { name: "TCX", extensions: ["tcx", "TCX"] },
          { name: "GPX", extensions: ["gpx", "GPX"] },
        ],
      });
    } catch (err) {
      setForceBrowserPicker(true);
      setImportMessage(
        `Native file picker unavailable (${err instanceof Error ? err.message : "unknown"}). Falling back to browser picker.`
      );
      // Trigger browser picker immediately so users do not need a second click.
      fileInputRef.current?.click();
      return;
    }
    if (!picked) return;

    const paths = (Array.isArray(picked) ? picked : [picked]).map((p) => p.trim());
    await importFromPaths(paths);
  }

  function handleSelectFilesClick() {
    if (isImporting || isSyncing) return;
    if (isTauriRuntime() && !forceBrowserPicker) {
      void importFromDesktopDialog();
      return;
    }
    fileInputRef.current?.click();
  }

  async function syncFromStorage() {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const paths = await api.listSyncFiles();
      const total = paths.length;
      if (total === 0) {
        setImportMessage("Sync complete: no supported files found.");
        return;
      }

      let imported = 0;
      let duplicates = 0;
      let blacklisted = 0;
      let skipped = 0;
      let failed = 0;

      pushImportProgress(
        { completed: 0, total, current: "Preparing sync queue...", status: "processing" },
        `Sync: 0/${total}`
      );
      await waitForUiPaint();

      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const fileName = path.split(/[\\/]/).pop() ?? path;
        const fileNameDisplay = shortenFileName(fileName);
        pushImportProgress(
          { completed: i, total, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
          `Sync: ${i + 1}/${total} - ${fileNameDisplay}`
        );
        await waitForUiPaint();

        try {
          const result = await api.processSyncFile(path);
          if (result.status === "imported") imported++;
          else if (result.status === "duplicate") duplicates++;
          else if (result.status === "blacklisted") blacklisted++;
          else if (result.status === "skipped") skipped++;
        } catch (err) {
          failed++;
          tracingError("sync file processing failed", err);
        }

        pushImportProgress(
          { completed: i + 1, total, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
          `Sync: ${i + 1}/${total} - ${fileNameDisplay}`
        );
        await waitForUiPaint();
      }

      try {
        pushImportProgress(
          {
            completed: total,
            total,
            current: "Refreshing activity list...",
            status: "refreshing",
          },
          "Sync finished, refreshing activity list..."
        );
        await refresh();
      } catch (err) {
        setImportMessage(`Sync finished, but refresh failed: ${err instanceof Error ? err.message : "unknown"}`);
        return;
      }
      setImportMessage(
        `Sync complete: scanned ${total}, imported ${imported}, duplicates ${duplicates}, blacklisted ${blacklisted}, skipped ${skipped}, failed ${failed}.`
      );
    } catch (err) {
      setImportMessage(`Sync failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setImportProgress(null);
      setIsSyncing(false);
    }
  }

  function tracingError(message: string, err: unknown) {
    console.warn(message, err);
  }

  /* ── Inline rename/delete ────────────────────────────────────────── */

  function onRenameClick() {
    if (!contextMenu) return;
    setRenameTarget({ id: contextMenu.activityId, name: contextMenu.activityName });
    setDeleteTarget(null);
    setContextMenu(null);
  }

  function onDeleteClick() {
    if (!contextMenu) return;
    setDeleteTarget(contextMenu.activityId);
    setRenameTarget(null);
    setContextMenu(null);
  }

  async function confirmRename() {
    if (!renameTarget || !renameTarget.name.trim()) { setRenameTarget(null); return; }
    await api.renameActivity(renameTarget.id, renameTarget.name.trim());
    await refresh();
    setRenameTarget(null);
  }

  async function confirmDelete() {
    if (deleteTarget === null) return;
    try {
      await api.deleteActivity(deleteTarget);
      if (selectedActivity?.id === deleteTarget) await selectActivity(null);
      await refresh();
    } catch (err) {
      setImportMessage(`Delete failed: ${err instanceof Error ? err.message : "unknown"}`);
      return;
    }
    setDeleteTarget(null);
    setImportMessage("Activity deleted.");
  }

  function onItemContextMenu(e: MouseEvent, activity: Activity) {
    e.preventDefault();
    setContextExportOpen(false);
    setContextMenu({
      x: e.clientX, y: e.clientY,
      activityId: activity.id,
      activityName: activity.activity_name || activity.file_name,
    });
  }

  /* ── Export handlers ─────────────────────────────────────────────── */

  async function handleSingleExport(activityId: number, format: ExportFormat) {
    setContextMenu(null);
    setContextExportOpen(false);
    const activity = activities.find((a) => a.id === activityId);
    if (!activity) return;
    try {
      await exportSingleActivity(activity, format);
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  async function handleBulkExport(format: ExportFormat) {
    if (filtered.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportBulkActivities(filtered, format, setExportProgress);
      if (result === "cancelled") {
        // User cancelled the folder picker — no-op
        return;
      }
    } catch (err) {
      console.error("Bulk export failed:", err);
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportProgress(null), 2000);
    }
  }

  async function handleBulkDelete() {
    if (filtered.length === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    setConfirmBulkDelete(false);
    const total = filtered.length;
    let failed = 0;
    const failedReasons: string[] = [];
    try {
      for (let i = 0; i < filtered.length; i++) {
        setBulkDeleteProgress({ done: i, total });
        try {
          await api.deleteActivity(filtered[i].id);
        } catch (err) {
          failed++;
          failedReasons.push(err instanceof Error ? err.message : "unknown");
          console.error(`Failed to delete activity ${filtered[i].id}:`, err);
        }
      }
      setBulkDeleteProgress({ done: total, total });
      if (selectedActivity && filtered.some((a) => a.id === selectedActivity.id)) {
        await selectActivity(null);
      }
      await refresh();
      setImportMessage(
        failed > 0
          ? `Bulk delete finished with ${failed} failure(s): ${failedReasons.slice(0, 2).join(" | ")}`
          : "Bulk delete completed."
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setImportMessage(`Bulk delete completed, but refresh failed: ${detail || "unknown"}`);
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteProgress(null);
    }
  }

  function clearFilters() {
    setDateFrom(undefined); setDateTo(undefined);
    setMinDurationMinutes(""); setMaxDurationMinutes("");
    setFilterSport("all"); setSearchQuery("");
  }

  const hasFilters = filterSport !== "all" || dateFrom || dateTo || minDurationMinutes || maxDurationMinutes || searchQuery;
  const importDisplayIndex = importProgress
    ? (importProgress.status === "processing"
        ? (importProgress.currentIndex ?? importProgress.completed)
        : importProgress.completed)
    : 0;
  const selectedMetadata = useMemo(
    () => parseActivityMetadata(selectedActivity?.metadata_json),
    [selectedActivity?.metadata_json]
  );
  const lapTimestampsUtc = useMemo(
    () => (selectedMetadata?.laps ?? [])
      .map((lap) => lap.start_ts_utc ?? lap.end_ts_utc ?? "")
      .filter((ts) => !!ts),
    [selectedMetadata]
  );
  const deviceBadgeSerial = typeof selectedMetadata?.file_id?.serial_number === "number"
    ? String(selectedMetadata.file_id.serial_number)
    : "";
  const detailStats = useMemo(() => {
    if (!selectedActivity) return [] as Array<{ key: string; label: string; value: string; secondary?: string; icon: "clock" | "distance" | "speed" | "heart" | "mountain" | "power" | "avg" }>;
    const out: Array<{ key: string; label: string; value: string; secondary?: string; icon: "clock" | "distance" | "speed" | "heart" | "mountain" | "power" | "avg" }> = [];
    const seen = new Set<string>();
    const push = (key: string, label: string, value: string | null | undefined, icon: "clock" | "distance" | "speed" | "heart" | "mountain" | "power" | "avg", secondary?: string) => {
      if (!value || seen.has(key)) return;
      seen.add(key);
      out.push({ key, label, value, secondary, icon });
    };

    push("duration", "Duration", formatDuration(selectedActivity.duration_s), "clock");
    push("distance", "Distance", `${(selectedActivity.distance_m / distanceDivisor).toFixed(2)} ${distanceSuffix}`, "distance");

    if (recordStats.avgSpeed > 0) push("avg_speed", "Avg Speed", `${recordStats.avgSpeed.toFixed(1)} km/h`, "speed");
    if (recordStats.maxSpeed > 0) push("max_speed", "Max Speed", `${recordStats.maxSpeed.toFixed(1)} km/h`, "speed");

    const session = selectedMetadata?.session ?? {};
    const metric = selectedMetadata?.activity_metrics ?? {};
    const avgPaceSec = selectedActivity.distance_m > 0
      ? selectedActivity.duration_s / (selectedActivity.distance_m / distanceDivisor)
      : 0;
    const avgPaceText = formatPace(avgPaceSec, distanceSuffix);
    const avgHr = recordStats.avgHr > 0 ? Math.round(recordStats.avgHr) : (typeof session.avg_heart_rate === "number" ? session.avg_heart_rate : null);
    const maxHr = recordStats.maxHr > 0 ? recordStats.maxHr : (typeof session.max_heart_rate === "number" ? session.max_heart_rate : null);
    if (avgHr && avgHr > 0) push("avg_hr", "Avg HR", `${Math.round(avgHr)} bpm`, "heart", avgPaceText !== "-" ? `Pace ${avgPaceText}` : undefined);
    if (maxHr && maxHr > 0) push("max_hr", "Max HR", `${Math.round(maxHr)} bpm`, "heart");

    if (recordStats.maxAlt > 0) push("max_alt", "Max Altitude", `${recordStats.maxAlt.toFixed(0)} m`, "mountain");
    if (recordStats.avgPower > 0) push("avg_power", "Avg Power", `${Math.round(recordStats.avgPower)} W`, "power");

    if (typeof session.avg_cadence === "number" && session.avg_cadence > 0) push("avg_cadence", "Avg Cadence", `${Math.round(session.avg_cadence)} rpm`, "avg");
    if (typeof session.max_cadence === "number" && session.max_cadence > 0) push("max_cadence", "Max Cadence", `${Math.round(session.max_cadence)} rpm`, "avg");
    if (typeof session.beginning_body_battery === "number") push("bb_start", "Body Battery Start", `${session.beginning_body_battery}`, "avg");
    if (typeof session.ending_body_battery === "number") push("bb_end", "Body Battery End", `${session.ending_body_battery}`, "avg");
    if (typeof metric.vo2_max === "number" && metric.vo2_max > 0) push("vo2_max", "VO2 Max", `${metric.vo2_max.toFixed(1)}`, "avg");
    if (lapTimestampsUtc.length > 0) push("laps", "Laps", String(lapTimestampsUtc.length), "avg");

    return out;
  }, [selectedActivity, selectedMetadata, recordStats, distanceDivisor, distanceSuffix, lapTimestampsUtc.length]);

  return (
    <div className="app-shell">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <button className="icon-btn sidebar-toggle-btn" onClick={() => setIsSidebarCollapsed((v) => !v)} aria-label="Toggle sidebar">
            <IconMenu />
          </button>
          <div className="brand">
            <div className="brand-icon"><img src={appIcon} alt="FIT Dashboard" className="brand-icon-img" /></div>
            <div className="brand-text">
              <h1>
                FIT Dashboard
                {supporterBadge && <span className="supporter-badge-inline" title="Supporter Badge Active">Supporter</span>}
              </h1>
              <span>Workout log Analytics</span>
            </div>
          </div>
        </div>
        <div className="header-center">
          <div className="view-toggle">
            <button id="tab-overview" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
            <button id="tab-individual" className={tab === "individual" ? "active" : ""} onClick={() => setTab("individual")}>Individual</button>
            <button id="tab-compare" className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>Compare</button>
          </div>
        </div>
        <div className="header-right">
          <button className="icon-btn" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Toggle theme" title={theme === "light" ? "Dark mode" : "Light mode"}>
            {theme === "light" ? <IconMoon /> : <IconSun />}
          </button>
          <button className="icon-btn" onClick={toggleSettings} aria-label="Settings" title="Settings"><IconSettings /></button>
          <button className="icon-btn" onClick={() => void onLogout()} aria-label="Logout" title="Logout"><IconLogout /></button>
        </div>
      </header>

      <SettingsPanel appVersion={appVersion} versionBadgeStatus={versionBadgeStatus} />

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className={`app-body ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className={`sidebar-mobile-backdrop ${isSidebarCollapsed ? "hidden" : ""}`} onClick={() => setIsSidebarCollapsed(true)} />

        <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
          {/* Collapsed strip (desktop only) */}
          <div className="sidebar-collapsed-strip">
            <button className="sidebar-expand-btn" onClick={() => setIsSidebarCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar">
              <IconExpand />
            </button>
            <span className="sidebar-collapsed-count">{filtered.length} logs</span>
          </div>

          {/* Full sidebar content */}
          <div className="sidebar-inner">
            <div className="sidebar-head">
              <h3>Activity Center</h3>
              <button className="sidebar-collapse-btn" onClick={() => setIsSidebarCollapsed(true)} aria-label="Collapse sidebar">
                <IconCollapse />
              </button>
            </div>

            {/* Import */}
            <section className="sidebar-section">
              <button className={`section-header ${isImportOpen ? "open" : ""} ${isImporting ? "active" : ""}`} onClick={() => {
                setIsImportOpen((v) => {
                  const next = !v;
                  if (next) setIsFilterOpen(false);
                  return next;
                });
              }}>
                <span className="section-title">{isImporting ? `Importing... ${importDisplayIndex}/${importProgress?.total ?? 0}` : "Import Activity Files"}</span>
                <span className="section-header-right"><span className="chevron"><IconChevron /></span></span>
              </button>
              {isImportOpen && (
                <div className="section-body">
                  <div
                    className={`import-zone import-dropzone ${isDragActive ? "drag-active" : ""}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isImporting && !isSyncing) setIsDragActive(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isImporting && !isSyncing) setIsDragActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const next = e.relatedTarget as Node | null;
                      if (!next || !e.currentTarget.contains(next)) {
                        setIsDragActive(false);
                      }
                    }}
                    onDrop={(e) => { void handleImportDrop(e); }}
                  >
                    <input ref={fileInputRef} type="file" accept=".fit,.FIT,.tcx,.TCX,.gpx,.GPX" multiple hidden onChange={(e) => { setForceBrowserPicker(false); void importBatch(e.target.files); e.currentTarget.value = ""; }} />
                    <div className="import-drop-label">Drag and drop .fit, .tcx, .gpx files here</div>
                    <div className="import-actions">
                      <button
                        className="import-btn"
                        onClick={handleSelectFilesClick}
                        disabled={isImporting || isSyncing}
                      >
                        {isImporting ? "Importing..." : "Select files (.fit/.tcx/.gpx)"}
                      </button>
                      <button
                        className="btn-secondary import-sync-btn"
                        onClick={() => void syncFromStorage()}
                        disabled={isImporting || isSyncing}
                        aria-label={isSyncing ? "Sync in progress" : "Sync"}
                        title={isSyncing ? "Sync in progress" : "Sync"}
                      >
                        {isSyncing ? <span className="btn-spinner" aria-hidden="true" /> : <><IconRefresh /> Sync</>}
                      </button>
                    </div>
                    {isImporting && importProgress && (
                      <div className="import-hint" role="status" aria-live="polite">
                        {`Import queue: ${importDisplayIndex}/${importProgress.total}`}
                        {importProgress.current ? ` - ${importProgress.current}` : ""}
                      </div>
                    )}
                    <span className="import-hint">Drop files here or use Select files. Batch queue runs sequentially for stability.</span>
                  </div>
                </div>
              )}
            </section>

            {/* Filters */}
            <section className="sidebar-section">
              <button className={`section-header ${isFilterOpen ? "open" : ""} ${hasFilters ? "active" : ""}`} onClick={() => {
                setIsFilterOpen((v) => {
                  const next = !v;
                  if (next) setIsImportOpen(false);
                  return next;
                });
              }}>
                <span className="section-title-with-action">
                  <span className="section-title">{hasFilters ? "Filter Active" : "Filters"}</span>
                  {hasFilters && (
                    <button
                      type="button"
                      className="section-header-reset"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        clearFilters();
                      }}
                      aria-label="Reset filters"
                      title="Reset filters"
                    >
                      <IconX />
                    </button>
                  )}
                </span>
                <span className="section-header-right"><span className="chevron"><IconChevron /></span></span>
              </button>
              {isFilterOpen && (
                <div className="section-body">
                  <div className="filter-fields">
                    <label>Sport<select value={filterSport} onChange={(e) => setFilterSport(e.target.value)}>
                      <option value="all">All Sports</option>
                      {sports.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></label>
                    <label>
                      Date Range
                      <div className="filter-date-wrapper" style={{ display: "flex", gap: "8px" }}>
                        <div style={{ flex: 1, position: "relative" }}>
                          <button
                            className="btn-outline-secondary"
                            type="button"
                            ref={dateFromBtnRef}
                            style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontWeight: "normal" }}
                            onClick={() => setDatePickerFromOpen(!datePickerFromOpen)}
                          >
                            {dateFrom ? formatDateShort(dateFrom.toISOString()) : "Start"}
                          </button>
                          <DatePickerPopover
                            isOpen={datePickerFromOpen}
                            onClose={() => setDatePickerFromOpen(false)}
                            selected={dateFrom}
                            onSelect={setDateFrom}
                            anchorRef={dateFromBtnRef}
                          />
                        </div>
                        <div style={{ flex: 1, position: "relative" }}>
                          <button
                            className="btn-outline-secondary"
                            type="button"
                            ref={dateToBtnRef}
                            style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontWeight: "normal" }}
                            onClick={() => setDatePickerToOpen(!datePickerToOpen)}
                          >
                            {dateTo ? formatDateShort(dateTo.toISOString()) : "End"}
                          </button>
                          <DatePickerPopover
                            isOpen={datePickerToOpen}
                            onClose={() => setDatePickerToOpen(false)}
                            selected={dateTo}
                            onSelect={setDateTo}
                            anchorRef={dateToBtnRef}
                          />
                        </div>
                      </div>
                    </label>
                    <label>
                      Duration (minutes)
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                        <input style={{ minWidth: 0 }} type="number" min="0" step="1" placeholder="Min" value={minDurationMinutes} onChange={(e) => setMinDurationMinutes(e.target.value)} />
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                        <input style={{ minWidth: 0 }} type="number" min="0" step="1" placeholder="Max" value={maxDurationMinutes} onChange={(e) => setMaxDurationMinutes(e.target.value)} />
                      </div>
                    </label>
                    <div className="filter-actions"><button className="btn-secondary" style={{ flex: 1 }} onClick={clearFilters}>Reset</button></div>
                  </div>
                </div>
              )}
            </section>

            {importMessage && <div className="import-message">{importMessage}</div>}

            <div className="sidebar-search">
              <div className="sidebar-search-row">
                <input id="sidebar-search-input" placeholder="Search by name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <div className="sidebar-sort-controls" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="sidebar-sort-btn"
                    type="button"
                    onClick={() => setIsSortOpen((open) => !open)}
                    aria-label={`Sort activities by ${sortBy}`}
                    title="Sort"
                  >
                    <IconSort />
                  </button>
                  <button
                    className="sidebar-sort-btn direction"
                    type="button"
                    onClick={() => setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"))}
                    aria-label={`Toggle sort direction: ${sortDirection === "asc" ? "ascending" : "descending"}`}
                    title={sortDirection === "asc" ? "Ascending" : "Descending"}
                  >
                    <IconSortDirection direction={sortDirection} />
                  </button>
                  {isSortOpen && (
                    <div className="sidebar-sort-dropdown">
                      <button type="button" className={sortBy === "date" ? "active" : ""} onClick={() => { setSortBy("date"); setIsSortOpen(false); }}>Date</button>
                      <button type="button" className={sortBy === "name" ? "active" : ""} onClick={() => { setSortBy("name"); setIsSortOpen(false); }}>Name</button>
                      <button type="button" className={sortBy === "duration" ? "active" : ""} onClick={() => { setSortBy("duration"); setIsSortOpen(false); }}>Duration</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="log-count">
              <span>{filtered.length} of {activities.length} logs selected</span>
              {hasFilters && <button onClick={clearFilters}>Clear filters</button>}
            </div>

            {/* Bulk Actions */}
            <div className="bulk-actions-bar" onClick={(e) => e.stopPropagation()}>
              <div className="bulk-export-wrapper">
                <button className="btn-outline-accent" disabled={filtered.length === 0 || isExporting} onClick={() => setBulkExportDropdownOpen((v) => !v)}>
                  <IconDownload /> Export filtered
                </button>
                {bulkExportDropdownOpen && (
                  <div className="bulk-export-dropdown">
                    <button onClick={() => { setBulkExportDropdownOpen(false); void handleBulkExport("csv"); }}>CSV</button>
                    <button onClick={() => { setBulkExportDropdownOpen(false); void handleBulkExport("json"); }}>JSON</button>
                    <button onClick={() => { setBulkExportDropdownOpen(false); void handleBulkExport("gpx"); }}>GPX</button>
                    <button onClick={() => { setBulkExportDropdownOpen(false); void handleBulkExport("kml"); }}>KML</button>
                  </div>
                )}
              </div>
              {!confirmBulkDelete ? (
                <button className="btn-outline-danger" disabled={filtered.length === 0 || isBulkDeleting} onClick={() => setConfirmBulkDelete(true)}>
                  <IconTrash /> Delete filtered
                </button>
              ) : (
                <div className="bulk-delete-confirm">
                  <span>Delete {filtered.length}?</span>
                  <button className="btn-compact danger" onClick={() => void handleBulkDelete()}><IconCheck /></button>
                  <button className="btn-compact cancel" onClick={() => setConfirmBulkDelete(false)}><IconX /></button>
                </div>
              )}
            </div>

            {/* Activity List */}
            <div className="activity-list-box">
              <div className="activity-list">
                {sortedForList.map((a) => {
                const isRenaming = renameTarget?.id === a.id;
                const isDeleting = deleteTarget === a.id;
                const isActive = selectedActivity?.id === a.id;

                  return (
                  <div key={a.id} className={`activity-item ${isActive ? "active" : ""}`}>
                    {isRenaming ? (
                      <div className="inline-rename">
                        <input
                          autoFocus
                          value={renameTarget.name}
                          onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void confirmRename();
                            if (e.key === "Escape") setRenameTarget(null);
                          }}
                        />
                        <div className="inline-actions">
                          <button className="btn-compact confirm" onClick={() => void confirmRename()} title="Save"><IconCheck /> Save</button>
                          <button className="btn-compact cancel" onClick={() => setRenameTarget(null)} title="Cancel"><IconX /> Cancel</button>
                        </div>
                      </div>
                    ) : isDeleting ? (
                      <div className="inline-delete-confirm">
                        <span>Delete this activity?</span>
                        <div className="inline-actions">
                          <button className="btn-compact danger" onClick={() => void confirmDelete()}><IconTrash /> Delete</button>
                          <button className="btn-compact cancel" onClick={() => setDeleteTarget(null)}><IconX /> Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="activity-item-wrapper" style={{ display: "flex", alignItems: "center", position: "relative", minWidth: 0 }}>
                        {tab === "compare" && (
                          <input 
                            className="compare-checkbox"
                            type="checkbox" 
                            checked={compareIds.includes(a.id)}
                            onChange={(e) => {
                               if (e.target.checked && compareIds.length < 4) {
                                  setCompareIds([...compareIds, a.id]);
                               } else if (!e.target.checked) {
                                  setCompareIds(compareIds.filter(id => id !== a.id));
                               }
                            }}
                            disabled={!compareIds.includes(a.id) && compareIds.length >= 4}
                          />
                        )}
                        <div
                          className="activity-item-content"
                          role="button"
                          tabIndex={0}
                          style={{ flex: 1, paddingLeft: tab === "compare" ? "8px" : "" }}
                          onClick={() => {
                            if (tab === "compare") {
                              const checked = compareIds.includes(a.id);
                              if (!checked && compareIds.length < 4) setCompareIds([...compareIds, a.id]);
                              else if (checked) setCompareIds(compareIds.filter(id => id !== a.id));
                            } else {
                              void selectActivity(a); 
                              setTab("individual"); 
                            }
                          }}
                          onContextMenu={(e) => onItemContextMenu(e, a)}
                        >
                          <span className="activity-name">{a.activity_name || a.file_name}</span>
                          <div className="activity-meta-rows">
                            <div className="activity-meta-row" style={{ color: "var(--text-muted)", marginBottom: "4px" }}>
                              <span>{formatDateShort(a.start_ts_utc)} &bull; {formatTimeShort(a.start_ts_utc)}</span>
                            </div>
                            <div className="activity-meta-row" style={{ fontWeight: 600 }}>
                              <span className="activity-pill">{(a.distance_m / distanceDivisor).toFixed(1)} {distanceSuffix}</span>
                              <span className="spacer" />
                              <span className="activity-pill">{formatDuration(a.duration_s)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="empty-state" style={{ minHeight: 120, border: "none", padding: "1rem" }}>
                    <span className="empty-icon"><IconClipboard /></span>
                    <span>No activities match filters</span>
                  </div>
                )}
              </div>
            </div>

            <div className="sidebar-footer">
              <div className="sidebar-footer-left">
                <span>{activities.length} file(s) imported</span>
                {versionBadgeStatus.state === "latest" && (
                  <span className="version-status-badge latest" title="You are on the latest release">
                    Latest
                  </span>
                )}
                {versionBadgeStatus.state === "update" && versionBadgeStatus.latestVersion && (
                  <a
                    className="version-status-badge update"
                    href="https://fitdashboard.app"
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`A newer release is available: ${versionBadgeStatus.latestVersion}`}
                  >
                    Update to {versionBadgeStatus.latestVersion}
                  </a>
                )}
              </div>
              <button onClick={() => void refresh()} title="Refresh data"><IconRefresh /></button>
            </div>
          </div>
        </aside>

        {/* ── Main Content ───────────────────────────────────── */}
        <main className="main-content">
          <DonationBanner
            supporterBadge={supporterBadge}
            dismissed={bannerDismissed}
            onDismiss={() => setBannerDismissed(true)}
          />

          {tab === "overview" ? (
            activities.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon"><IconBarChart size={40} /></span>
                <span>Import logs to see overview.</span>
              </div>
            ) : (
            <>
              <div className="stats-row">
                <div className="stat-card"><div className="stat-icon"><IconActivity /></div><div className="stat-value">{filtered.length}</div><div className="stat-label">Filtered Activities</div></div>
                <div className="stat-card"><div className="stat-icon"><IconDistance /></div><div className="stat-value">{totalDistance.toFixed(1)} <small>{distanceSuffix}</small></div><div className="stat-label">Total Distance</div></div>
                <div className="stat-card"><div className="stat-icon"><IconClock /></div><div className="stat-value">{formatDuration(totalDuration)}</div><div className="stat-label">Total Duration</div></div>
                <div className="stat-card"><div className="stat-icon"><IconSport /></div><div className="stat-value">{filteredSports.length}</div><div className="stat-label">Unique Sports</div></div>
              </div>
              <div className="stats-row">
                <div className="stat-card"><div className="stat-icon"><IconAvg /></div><div className="stat-value">{avgDistance.toFixed(1)} <small>{distanceSuffix}</small></div><div className="stat-label">Avg Distance / Activity</div></div>
                <div className="stat-card"><div className="stat-icon"><IconClock /></div><div className="stat-value">{formatDurationShort(avgDuration)}</div><div className="stat-label">Avg Duration / Activity</div></div>
                <div className="stat-card"><div className="stat-icon"><IconDevice /></div><div className="stat-value">{filteredDevices.length}</div><div className="stat-label">Devices</div></div>
              </div>
              <div className="overview-contribution-row">
                <div className="overview-contribution-main">
                  <ActivityContributionHeatmap activities={filtered} />
                </div>
                <div className="overview-contribution-side">
                  <OverviewSportTypeDonut activities={filtered} theme={theme} />
                </div>
              </div>
              <OverviewLocationMap records={overviewRecords} mapStyle={mapStyle} setMapStyle={setMapStyle} />
              <OverviewWeeklyTrend activities={filtered} distanceUnit={distanceUnit} theme={theme} />
            </>
            )
          ) : tab === "compare" ? (
            <CompareCharts compareIds={compareIds} activities={activities} theme={theme} />
          ) : selectedActivity ? (
            <>
              <div className="detail-header">
                <div className="detail-title-row">
                  <h2>{selectedActivity.activity_name || selectedActivity.file_name}</h2>
                  <div className="detail-badges">
                    <span className="badge">{formatDate(selectedActivity.start_ts_utc)}</span>
                    {selectedActivity.sport && <span className="badge sport">{selectedActivity.sport}</span>}
                    {deviceBadgeSerial && <span className="badge device">SN {deviceBadgeSerial}</span>}
                    <label className="detail-toggle-badge" title="Use dynamic rolling average smoothing. As you zoom in, more detailed points are used.">
                      <input
                        type="checkbox"
                        checked={smoothGraphs}
                        onChange={(e) => setSmoothGraphs(e.target.checked)}
                      />
                      <span>Smooth graphs</span>
                    </label>
                    <button className="btn-secondary" style={{ padding: "0.25rem 0.55rem", fontSize: "0.74rem" }} onClick={() => setTelemetryZoom(null)}>
                      Reset Zoom
                    </button>
                  </div>
                </div>
                <div className="detail-stats-strip">
                  {detailStats.map((s) => (
                    <div key={s.key} className="mini-stat">
                      <span className={`mini-icon ${s.key === "max_hr" ? "danger" : ""}`}>
                        {s.icon === "clock" && <IconClock />}
                        {s.icon === "distance" && <IconDistance />}
                        {s.icon === "speed" && <IconSpeed />}
                        {s.icon === "heart" && <IconHeart />}
                        {s.icon === "mountain" && <IconMountain />}
                        {s.icon === "power" && <IconPower />}
                        {s.icon === "avg" && <IconAvg />}
                      </span>
                      <span className="mini-value">{s.value}</span>
                      <span className="mini-label">{s.label}</span>
                      {s.secondary && <span className="mini-label" style={{ fontSize: "0.68rem", marginTop: "2px" }}>{s.secondary}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="detail-grid">
                <div className="panel"><h3>Heart Rate and Pace</h3><ActivityChart records={selectedRecords} theme={theme} zoomRange={telemetryZoom} onZoomChange={setTelemetryZoom} lapTimestampsUtc={lapTimestampsUtc} smoothGraphs={smoothGraphs} /></div>
                <ActivityMap records={selectedRecords} mapStyle={mapStyle} setMapStyle={setMapStyle} lapTimestampsUtc={lapTimestampsUtc} />
              </div>
              <ActivityInsights records={selectedRecords} theme={theme} zoomRange={telemetryZoom} onZoomChange={setTelemetryZoom} lapTimestampsUtc={lapTimestampsUtc} smoothGraphs={smoothGraphs} />
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-icon"><IconBarChart size={40} /></span>
              <span>Select an activity from the sidebar to inspect individual telemetry.</span>
            </div>
          )}
        </main>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button onClick={onRenameClick}><IconEdit /> Rename</button>
          <button className="ctx-danger" onClick={onDeleteClick}><IconTrash /> Delete</button>
          <div className="ctx-divider" />
          <div className="ctx-export-parent" onMouseEnter={() => setContextExportOpen(true)} onMouseLeave={() => setContextExportOpen(false)}>
            <button className="ctx-with-submenu"><IconDownload /> Export <IconChevron /></button>
            {contextExportOpen && (
              <div className="ctx-submenu">
                <button onClick={() => void handleSingleExport(contextMenu.activityId, "csv")}><IconFile /> CSV</button>
                <button onClick={() => void handleSingleExport(contextMenu.activityId, "json")}><IconFile /> JSON</button>
                <button onClick={() => void handleSingleExport(contextMenu.activityId, "gpx")}><IconFile /> GPX</button>
                <button onClick={() => void handleSingleExport(contextMenu.activityId, "kml")}><IconFile /> KML</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Operation Progress Overlay */}
      {(isExporting || isBulkDeleting) && (
        <div className="bulk-progress-overlay">
          <div className="bulk-progress-modal">
            <div className="bulk-progress-title">
              {isExporting ? (
                <><IconDownload /> Exporting Activities</>
              ) : (
                <><IconTrash /> Deleting Activities</>
              )}
            </div>
            {isExporting && exportProgress && (
              <>
                <div className="bulk-progress-file">{exportProgress.currentFile || "Finishing..."}</div>
                <div className="bulk-progress-track">
                  <div className="bulk-progress-fill" style={{ width: `${(exportProgress.done / (exportProgress.total || 1)) * 100}%` }} />
                </div>
                <div className="bulk-progress-stats">
                  <span>{exportProgress.done} of {exportProgress.total}</span>
                  <span>{Math.round((exportProgress.done / (exportProgress.total || 1)) * 100)}%</span>
                </div>
              </>
            )}
            {isBulkDeleting && bulkDeleteProgress && (
              <>
                <div className="bulk-progress-file">Removing activity data...</div>
                <div className="bulk-progress-track">
                  <div className="bulk-progress-fill danger" style={{ width: `${(bulkDeleteProgress.done / (bulkDeleteProgress.total || 1)) * 100}%` }} />
                </div>
                <div className="bulk-progress-stats">
                  <span>{bulkDeleteProgress.done} of {bulkDeleteProgress.total}</span>
                  <span>{Math.round((bulkDeleteProgress.done / (bulkDeleteProgress.total || 1)) * 100)}%</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
