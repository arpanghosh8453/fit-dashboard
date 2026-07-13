import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { api } from "../lib/api";
import { openExternalLink } from "../lib/links";
import { useTranslation, LANGUAGES } from "../lib/i18n";
import { DEFAULT_HR_ZONE_BOUNDS, HR_ZONE_COLORS } from "../lib/hrZones";

type StorageInfo = {
  data_dir: string;
  db_path: string;
  fit_files_dir: string;
};

type VersionBadgeStatus = {
  state: "hidden" | "latest" | "update";
  latestVersion: string | null;
};

type Props = {
  appVersion: string;
  versionBadgeStatus: VersionBadgeStatus;
};

const iconProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconBug() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...iconProps}><path d="M20 8h-2.2a6.9 6.9 0 00-1.3-1.3l1.1-1.9-1.7-1-1.1 1.9a7.3 7.3 0 00-2.7-.6 7.3 7.3 0 00-2.7.6L8.3 3.8l-1.7 1 1.1 1.9A6.9 6.9 0 006.4 8H4v2h2v2H4v2h2v2a6 6 0 006 6 6 6 0 006-6v-2h2v-2h-2v-2h2z" /><circle cx="10" cy="11" r="1" /><circle cx="14" cy="11" r="1" /><path d="M9.5 15c.8.7 1.6 1 2.5 1 .9 0 1.7-.3 2.5-1" /></svg>;
}

function IconDiscord() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.791 19.791 0 0015.39 2.8a14.99 14.99 0 00-.678 1.367 18.27 18.27 0 00-5.424 0A14.9 14.9 0 008.61 2.8a19.736 19.736 0 00-4.928 1.57C.564 9.092-.282 13.695.141 18.234a19.91 19.91 0 006.034 2.966c.489-.67.924-1.378 1.294-2.119a12.777 12.777 0 01-2.037-.978c.172-.126.339-.257.501-.39a14.165 14.165 0 0012.134 0c.162.133.329.264.501.39-.649.382-1.33.709-2.038.978.37.74.805 1.448 1.295 2.118a19.88 19.88 0 006.033-2.965c.496-5.263-.845-9.823-3.541-13.865zM9.75 15.081c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.951-2.418 2.157-2.418 1.215 0 2.166 1.095 2.157 2.418 0 1.334-.951 2.419-2.157 2.419zm4.5 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.951-2.418 2.157-2.418 1.214 0 2.166 1.095 2.157 2.418 0 1.334-.943 2.419-2.157 2.419z" />
    </svg>
  );
}

function IconGlobe() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...iconProps}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 010 20" /><path d="M12 2a15 15 0 000 20" /></svg>;
}

function IconMail() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...iconProps}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}

/* ── Heart Rate Zone Slider Dialog ──────────────────────────────────── */

const SLIDER_MIN = 75;
const SLIDER_MAX = 300;
const MIN_GAP = 5; // minimum bpm gap between adjacent handles

function HeartRateZoneDialog({
  bounds,
  onSave,
  onClose,
  t,
}: {
  bounds: number[];
  onSave: (b: number[]) => void;
  onClose: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [draft, setDraft] = useState<number[]>([...bounds]);
  const [dragging, setDragging] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const pct = (val: number) => ((val - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;

  const updateDraft = useCallback((idx: number, clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let newVal = Math.round(SLIDER_MIN + ratio * (SLIDER_MAX - SLIDER_MIN));

    // Enforce min/max and min-gap between neighbours
    const minBound = idx === 0 ? SLIDER_MIN + MIN_GAP : draft[idx - 1] + MIN_GAP;
    const maxBound = idx === draft.length - 1 ? SLIDER_MAX - MIN_GAP : draft[idx + 1] - MIN_GAP;
    newVal = Math.max(minBound, Math.min(maxBound, newVal));

    setDraft((prev) => {
      const next = [...prev];
      next[idx] = newVal;
      return next;
    });
  }, [draft]);

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => updateDraft(dragging, e.clientX);
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, updateDraft]);

  // 5 zone segments
  const segmentEdges = [SLIDER_MIN, ...draft, SLIDER_MAX];
  const zones = HR_ZONE_COLORS.slice(0, 5);

  // Zone label info
  const zoneLabels = zones.map((color, i) => {
    const lo = i === 0 ? 0 : draft[i - 1] + 1;
    const hi = i === 4 ? null : draft[i];
    const range = hi === null ? `>${draft[3]} bpm` : (lo === 0 ? `≤${hi} bpm` : `${lo}–${hi} bpm`);
    return { name: `Z${i + 1}`, range, color };
  });

  return (
    <div className="hr-zone-dialog-overlay">
      <div className="hr-zone-dialog-backdrop" onClick={onClose} />
      <div className="hr-zone-dialog">
        <div className="hr-zone-dialog-header">
          <h3>{t("settings.hrZonesTitle")}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t("settings.closeSettings")}>&times;</button>
        </div>
        <p className="hr-zone-dialog-desc">{t("settings.hrZonesDescription")}</p>

        <div className="hr-zone-slider-container">
          <div className="hr-zone-slider" ref={trackRef}>
            {/* Gradient track with zone segments */}
            <div className="hr-zone-track">
              {zones.map((color, i) => {
                const left = pct(segmentEdges[i]);
                const right = pct(segmentEdges[i + 1]);
                return (
                  <div
                    key={i}
                    className="hr-zone-segment"
                    style={{
                      left: `${left}%`,
                      width: `${right - left}%`,
                      background: color,
                    }}
                  />
                );
              })}
            </div>

            {/* Draggable handles */}
            {draft.map((val, idx) => (
              <div
                key={idx}
                className={`hr-zone-handle ${dragging === idx ? "dragging" : ""}`}
                style={{
                  left: `${pct(val)}%`,
                  color: zones[idx + 1] ?? zones[idx],
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDragging(idx);
                }}
              >
                <span className="hr-zone-handle-value">{val}</span>
              </div>
            ))}
          </div>

          {/* Zone labels below slider */}
          <div className="hr-zone-labels">
            {zoneLabels.map((z) => (
              <div key={z.name} className="hr-zone-label-item">
                <span className="hr-zone-label-name" style={{ color: z.color }}>{z.name}</span>
                <span className="hr-zone-label-range">{z.range}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hr-zone-dialog-actions">
          <button
            className="btn-secondary"
            onClick={() => setDraft([...DEFAULT_HR_ZONE_BOUNDS])}
          >
            {t("settings.hrZonesReset")}
          </button>
          <button
            className="btn-primary"
            onClick={() => { onSave(draft); onClose(); }}
          >
            {t("settings.hrZonesSave")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Settings Panel ────────────────────────────────────────────────── */

export function SettingsPanel({ appVersion, versionBadgeStatus }: Props) {
  const {
    showSettings,
    theme,
    distanceUnit,
    timeFormat,
    mapStyle,
    supporterBadge,
    hrZoneBounds,
    setTheme,
    setDistanceUnit,
    setTimeFormat,
    setMapStyle,
    setHrZoneBounds,
    verifySupporterCode,
    removeSupporterBadge,
    toggleSettings
  } = useSettingsStore();
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const language = useSettingsStore((s) => s.language);
  const { t } = useTranslation();

  const [codeInput, setCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [clearingBlacklist, setClearingBlacklist] = useState(false);
  const [blacklistMsg, setBlacklistMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [blacklistCount, setBlacklistCount] = useState<number | null>(null);
  const [showHrZoneDialog, setShowHrZoneDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!showSettings) return;

    void Promise.all([api.getStorageInfo(), api.getBlacklistedHashCount()])
      .then(([info, count]) => {
        if (cancelled) return;
        setStorageInfo(info);
        setBlacklistCount(count.count);
      })
      .catch(() => {
        if (!cancelled) {
          setStorageInfo(null);
          setBlacklistCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showSettings]);

  if (!showSettings) {
    return null;
  }

  async function handleVerifyCode() {
    if (!codeInput.trim()) return;
    setVerifying(true);
    setCodeMsg(null);
    const valid = await verifySupporterCode(codeInput.trim());
    setVerifying(false);
    if (valid) {
      setCodeMsg({ type: "success", text: t("settings.badgeActivated") });
      setCodeInput("");
    } else {
      setCodeMsg({ type: "error", text: t("settings.invalidCode") });
    }
  }

  async function handleClearBlacklist() {
    const ok = window.confirm(t("settings.confirmClearBlacklist"));
    if (!ok) return;
    setClearingBlacklist(true);
    setBlacklistMsg(null);
    try {
      const result = await api.clearBlacklistedHashes();
      setBlacklistMsg({ type: "success", text: t("settings.clearedHashes", { count: result.removed }) });
      setBlacklistCount(0);
    } catch (err) {
      setBlacklistMsg({
        type: "error",
        text: t("settings.clearBlacklistFailed", { error: err instanceof Error ? err.message : "unknown" }),
      });
    } finally {
      setClearingBlacklist(false);
    }
  }

  return (
    <div className="settings-overlay">
      <div className="settings-backdrop" onClick={toggleSettings} />
      <div className="settings-drawer">
        <div className="settings-drawer-header">
          <h3>{t("settings.title")}</h3>
          <button className="icon-btn" onClick={toggleSettings} aria-label={t("settings.closeSettings")}>&times;</button>
        </div>

        <div className="settings-grid">
          <label><span>{t("settings.language")}</span><select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select></label>

          <label><span>{t("settings.theme")}</span><select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark")}>
            <option value="light">{t("settings.themeLight")}</option>
            <option value="dark">{t("settings.themeDark")}</option>
          </select></label>

          <label><span>{t("settings.distanceUnit")}</span><select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as "km" | "mi")}>
            <option value="km">{t("settings.kilometers")}</option>
            <option value="mi">{t("settings.miles")}</option>
          </select></label>

          <label><span>{t("settings.timeFormat")}</span><select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as "12h" | "24h")}>
            <option value="24h">{t("settings.24hour")}</option>
            <option value="12h">{t("settings.12hour")}</option>
          </select></label>

          <label><span>{t("settings.mapStyle")}</span><select value={mapStyle} onChange={(e) => setMapStyle(e.target.value as any)}>
              <option value="default">{t("settings.mapDefault")}</option>
              <option value="light">{t("settings.mapLight")}</option>
              <option value="dark">{t("settings.mapDark")}</option>
              <option value="openstreet">{t("settings.mapOpenStreet")}</option>
              <option value="topo">{t("settings.mapTopo")}</option>
              <option value="satellite">{t("settings.mapSatellite")}</option>
            </select>
          </label>

          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <button
              className="hr-zone-btn-customize"
              onClick={() => setShowHrZoneDialog(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
              </svg>
              {t("settings.customizeHrZones")}
            </button>
          </div>
        </div>

        <div className="links-box">
          <strong>{t("settings.linksAndContact")}</strong>
          <div className="settings-links-grid">
            <a className="settings-link-btn" href="https://github.com/arpanghosh8453/fit-dashboard/issues/new/choose" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconBug /> {t("settings.bugReport")}
            </a>
            <a className="settings-link-btn" href="https://discord.gg/xVu4gK75zG" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconDiscord /> {t("settings.joinDiscord")}
            </a>
            <a className="settings-link-btn" href="https://fitdashboard.app" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconGlobe /> {t("settings.website")}
            </a>
            <a className="settings-link-btn" href="https://www.fitdashboard.app/#about" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconMail /> {t("settings.contact")}
            </a>
          </div>
        </div>

        <div className="supporter-box">
          <div style={{ flex: 1 }}>
            <strong>{t("settings.supporterBadge")}</strong>
            <p className="small">
              {supporterBadge
                ? t("settings.thankYou")
                : t("settings.enterCode")}
            </p>
            {supporterBadge && (
              <div className="supporter-badge-row">
                <span className="supporter-badge-inline" title="Supporter Badge Active">{t("settings.supporter")}</span>
              </div>
            )}
          </div>
          {!supporterBadge ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder={t("settings.codePlaceholder")}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                  style={{ width: "110px", fontSize: "12px", padding: "0.35rem" }}
                />
                <button
                  className="btn-primary"
                  onClick={handleVerifyCode}
                  disabled={verifying || !codeInput.trim()}
                  style={{ padding: "0.35rem 0.7rem", fontSize: "12px" }}
                >
                  {verifying ? "..." : t("settings.verify")}
                </button>
              </div>
              {codeMsg && (
                <span style={{ fontSize: "11px", color: codeMsg.type === "success" ? "var(--success)" : "var(--danger)" }}>
                  {codeMsg.text}
                </span>
              )}
            </div>
          ) : (
            <button
              className="btn-secondary"
              onClick={() => void removeSupporterBadge()}
              style={{ whiteSpace: "nowrap" }}
            >
              {t("settings.removeBadge")}
            </button>
          )}
        </div>

        <div className="storage-box">
          <strong>{t("settings.storageLocations")}</strong>
          {storageInfo ? (
            <div className="storage-meta">
              <div>
                <span>{t("settings.appVersion")}</span> <code>{appVersion}</code>
                {versionBadgeStatus.state === "latest" && (
                  <span className="version-status-badge latest" title="You are on the latest release">
                    {t("settings.latest")}
                  </span>
                )}
                {versionBadgeStatus.state === "update" && versionBadgeStatus.latestVersion && (
                  <a
                    className="version-status-badge update"
                    href="https://fitdashboard.app"
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`A newer release is available: ${versionBadgeStatus.latestVersion}`}
                    onClick={openExternalLink}
                  >
                    {t("settings.updateTo", { version: versionBadgeStatus.latestVersion })}
                  </a>
                )}
              </div>
              <div><span>{t("settings.appData")}</span> <code>{storageInfo.data_dir}</code></div>
              <div><span>{t("settings.database")}</span> <code>{storageInfo.db_path}</code></div>
              <div><span>{t("settings.fitFiles")}</span> <code>{storageInfo.fit_files_dir}</code></div>
            </div>
          ) : (
            <p className="small">{t("settings.storageUnavailable")}</p>
          )}

          <div style={{ marginTop: "0.7rem", display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-start" }}>
            <span className="small">
              {t("settings.blacklistedHashes")} <strong>{blacklistCount ?? "-"}</strong>
            </span>
            <button
              className="btn-danger"
              onClick={() => void handleClearBlacklist()}
              disabled={clearingBlacklist}
            >
              {clearingBlacklist ? t("settings.clearing") : t("settings.clearBlacklist")}
            </button>
            {blacklistMsg && (
              <span
                className="small"
                style={{ color: blacklistMsg.type === "success" ? "var(--success)" : "var(--danger)" }}
              >
                {blacklistMsg.text}
              </span>
            )}
          </div>
        </div>

        {showHrZoneDialog && (
          <HeartRateZoneDialog
            bounds={hrZoneBounds}
            onSave={setHrZoneBounds}
            onClose={() => setShowHrZoneDialog(false)}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
