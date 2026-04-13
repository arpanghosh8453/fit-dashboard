/**
 * Export utilities for FIT Dashboard activity data.
 * Supports CSV, JSON, GPX and KML formats.
 */

import type { Activity, RecordPoint } from "../types";
import { api } from "./api";

/* ── Helpers ─────────────────────────────────────────────────────── */

function escapeCsv(value: string): string {
  if (value.includes('"')) value = value.replace(/"/g, '""');
  if (value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value}"`;
  }
  return value;
}

function escapeXml(str: string | number | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNum(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return "";
  return Number(val.toFixed(decimals)).toString();
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/_{2,}/g, "_");
}

/* ── CSV ─────────────────────────────────────────────────────────── */

export function buildCsv(activity: Activity, records: RecordPoint[]): string {
  const headers = [
    "timestamp_ms",
    "latitude",
    "longitude",
    "altitude_m",
    "distance_m",
    "speed_m_s",
    "speed_kmh",
    "heart_rate",
    "cadence",
    "power_w",
    "temperature_c",
    "metadata",
  ];

  const metadata = JSON.stringify({
    format: "FIT Dashboard CSV Export",
    exported_at: new Date().toISOString(),
    activity_name: activity.activity_name || activity.file_name,
    sport: activity.sport,
    device: activity.device,
    start_ts_utc: activity.start_ts_utc,
    duration_s: activity.duration_s,
    distance_m: activity.distance_m,
  });

  if (records.length === 0) {
    const emptyRow = Array(headers.length - 1).fill("").concat(escapeCsv(metadata));
    return [headers.join(","), emptyRow.join(",")].join("\n");
  }

  const rows = records.map((r, i) => {
    const values = [
      String(r.timestamp_ms),
      formatNum(r.latitude, 7),
      formatNum(r.longitude, 7),
      formatNum(r.altitude_m),
      formatNum(r.distance_m),
      formatNum(r.speed_m_s, 3),
      r.speed_m_s != null ? formatNum(r.speed_m_s * 3.6, 2) : "",
      r.heart_rate != null ? String(r.heart_rate) : "",
      r.cadence != null ? String(r.cadence) : "",
      r.power != null ? String(r.power) : "",
      formatNum(r.temperature_c, 1),
      i === 0 ? escapeCsv(metadata) : "",
    ].map(escapeCsv);
    return values.join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/* ── JSON ────────────────────────────────────────────────────────── */

export function buildJson(activity: Activity, records: RecordPoint[]): string {
  return JSON.stringify(
    {
      _exportInfo: {
        format: "FIT Dashboard JSON Export",
        exportedAt: new Date().toISOString(),
      },
      activity: {
        id: activity.id,
        fileName: activity.file_name,
        activityName: activity.activity_name,
        sport: activity.sport,
        device: activity.device,
        startTimeUtc: activity.start_ts_utc,
        endTimeUtc: activity.end_ts_utc,
        durationS: activity.duration_s,
        distanceM: activity.distance_m,
      },
      records,
    },
    null,
    2
  );
}

/* ── GPX ─────────────────────────────────────────────────────────── */

export function buildGpx(activity: Activity, records: RecordPoint[]): string {
  const name = escapeXml(activity.activity_name || activity.file_name || "Activity");
  const startMs = new Date(activity.start_ts_utc).getTime();

  const gpsRecords = records.filter(
    (r) => typeof r.latitude === "number" && typeof r.longitude === "number"
  );

  if (gpsRecords.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FIT Dashboard">
  <metadata>
    <name>${name}</name>
  </metadata>
</gpx>`;
  }

  const trackpoints = gpsRecords
    .map((r) => {
      const lat = r.latitude!;
      const lng = r.longitude!;
      const eleStr = r.altitude_m != null ? `<ele>${r.altitude_m}</ele>` : "";
      const timeStr =
        !isNaN(startMs) && r.timestamp_ms
          ? `<time>${new Date(startMs + r.timestamp_ms).toISOString()}</time>`
          : "";
      const extensions =
        r.heart_rate != null || r.cadence != null || r.power != null
          ? `<extensions>${r.heart_rate != null ? `<hr>${r.heart_rate}</hr>` : ""}${r.cadence != null ? `<cad>${r.cadence}</cad>` : ""}${r.power != null ? `<power>${r.power}</power>` : ""}</extensions>`
          : "";

      return `      <trkpt lat="${lat}" lon="${lng}">
        ${eleStr}
        ${timeStr}
        ${extensions}
      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FIT Dashboard">
  <trk>
    <name>${name}</name>
    <type>${escapeXml(activity.sport)}</type>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;
}

/* ── KML ─────────────────────────────────────────────────────────── */

export function buildKml(activity: Activity, records: RecordPoint[]): string {
  const name = escapeXml(activity.activity_name || activity.file_name || "Activity");

  const gpsRecords = records.filter(
    (r) => typeof r.latitude === "number" && typeof r.longitude === "number"
  );

  if (gpsRecords.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
  </Document>
</kml>`;
  }

  const coordinates = gpsRecords
    .map((r) => `${r.longitude},${r.latitude},${r.altitude_m ?? 0}`)
    .join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <Style id="activityPath">
      <LineStyle>
        <color>ff0080ff</color>
        <width>3</width>
      </LineStyle>
    </Style>
    <Placemark>
      <name>${name}</name>
      <styleUrl>#activityPath</styleUrl>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

/* ── Download helper (browser) ───────────────────────────────────── */

export function downloadFile(filename: string, content: string, mimeType = "text/plain"): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Single export ────────────────────────────────────────────────── */

export type ExportFormat = "csv" | "json" | "gpx" | "kml";

export async function exportSingleActivity(
  activity: Activity,
  format: ExportFormat
): Promise<void> {
  const records = await api.getRecords(activity.id, 1000); // high-res for export

  let content = "";
  if (format === "csv") content = buildCsv(activity, records);
  else if (format === "json") content = buildJson(activity, records);
  else if (format === "gpx") content = buildGpx(activity, records);
  else if (format === "kml") content = buildKml(activity, records);

  if (!content) return;

  const baseName = sanitizeFileName(activity.activity_name || activity.file_name || "activity");
  downloadFile(`${baseName}.${format}`, content);
}

/* ── Bulk export ──────────────────────────────────────────────────── */

export type BulkExportProgress = {
  done: number;
  total: number;
  currentFile: string;
};

/**
 * Write a string to a file inside a directory handle (File System Access API).
 */
async function writeToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  filename: string,
  content: string
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function buildContent(
  activity: Activity,
  records: RecordPoint[],
  format: ExportFormat
): string {
  if (format === "csv") return buildCsv(activity, records);
  if (format === "json") return buildJson(activity, records);
  if (format === "gpx") return buildGpx(activity, records);
  if (format === "kml") return buildKml(activity, records);
  return "";
}

export async function exportBulkActivities(
  activities: Activity[],
  format: ExportFormat,
  onProgress?: (progress: BulkExportProgress) => void
): Promise<"done" | "cancelled"> {
  if (activities.length === 0) return "done";

  // Try to get a directory handle via File System Access API
  let dirHandle: FileSystemDirectoryHandle | null = null;
  const w = window as Window & {
    showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  };

  if (typeof w.showDirectoryPicker === "function") {
    try {
      dirHandle = await w.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") return "cancelled"; // user pressed Cancel
      // API available but errored — fall through to download fallback
      console.warn("Directory picker failed, falling back to downloads:", err);
    }
  }

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const baseName = sanitizeFileName(
      activity.activity_name || activity.file_name || "activity"
    );
    const filename = `${baseName}_${activity.id}.${format}`;
    onProgress?.({ done: i, total: activities.length, currentFile: baseName });

    try {
      const records = await api.getRecords(activity.id, 1000);
      const content = buildContent(activity, records, format);
      if (!content) continue;

      if (dirHandle) {
        await writeToDirectory(dirHandle, filename, content);
      } else {
        downloadFile(filename, content);
        await new Promise((r) => setTimeout(r, 150)); // avoid download throttling
      }
    } catch (err) {
      console.error(`Failed to export activity ${activity.id}:`, err);
    }
  }

  onProgress?.({ done: activities.length, total: activities.length, currentFile: "" });
  return "done";
}
