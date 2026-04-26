import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { api } from "../lib/api";
import { openExternalLink } from "../lib/links";

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

export function SettingsPanel({ appVersion, versionBadgeStatus }: Props) {
  const {
    showSettings,
    theme,
    distanceUnit,
    timeFormat,
    mapStyle,
    supporterBadge,
    setTheme,
    setDistanceUnit,
    setTimeFormat,
    setMapStyle,
    verifySupporterCode,
    removeSupporterBadge,
    toggleSettings
  } = useSettingsStore();

  const [codeInput, setCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [clearingBlacklist, setClearingBlacklist] = useState(false);
  const [blacklistMsg, setBlacklistMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [blacklistCount, setBlacklistCount] = useState<number | null>(null);

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
      setCodeMsg({ type: "success", text: "Supporter badge activated!" });
      setCodeInput("");
    } else {
      setCodeMsg({ type: "error", text: "Invalid code. Please try again." });
    }
  }

  async function handleClearBlacklist() {
    const ok = window.confirm("Clear all blacklisted file hashes? Deleted activities will be importable again.");
    if (!ok) return;
    setClearingBlacklist(true);
    setBlacklistMsg(null);
    try {
      const result = await api.clearBlacklistedHashes();
      setBlacklistMsg({ type: "success", text: `Cleared ${result.removed} blacklisted hash(es).` });
      setBlacklistCount(0);
    } catch (err) {
      setBlacklistMsg({
        type: "error",
        text: `Failed to clear blacklist: ${err instanceof Error ? err.message : "unknown"}`,
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
          <h3>Settings</h3>
          <button className="icon-btn" onClick={toggleSettings} aria-label="Close settings">&times;</button>
        </div>

        <div className="settings-grid">
          <label><span>Theme</span><select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark")}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select></label>

          <label><span>Distance Unit</span><select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as "km" | "mi")}>
            <option value="km">Kilometers</option>
            <option value="mi">Miles</option>
          </select></label>

          <label><span>Time Format</span><select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as "12h" | "24h")}>
            <option value="24h">24-hour</option>
            <option value="12h">12-hour</option>
          </select></label>

          <label><span>Map Style</span><select value={mapStyle} onChange={(e) => setMapStyle(e.target.value as any)}>
              <option value="default">Default</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="openstreet">OpenStreet</option>
              <option value="topo">Topo</option>
              <option value="satellite">Satellite</option>
            </select>
          </label>
        </div>

        <div className="links-box">
          <strong>Links and Contact</strong>
          <div className="settings-links-grid">
            <a className="settings-link-btn" href="https://github.com/arpanghosh8453/fit-dashboard/issues/new/choose" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconBug /> Bug Report
            </a>
            <a className="settings-link-btn" href="https://discord.gg/xVu4gK75zG" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconDiscord /> Join Discord
            </a>
            <a className="settings-link-btn" href="https://fitdashboard.app" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconGlobe /> Website
            </a>
            <a className="settings-link-btn" href="https://www.fitdashboard.app/#about" target="_blank" rel="noreferrer noopener" onClick={openExternalLink}>
              <IconMail /> Contact
            </a>
          </div>
        </div>

        <div className="supporter-box">
          <div style={{ flex: 1 }}>
            <strong>Supporter Badge</strong>
            <p className="small">
              {supporterBadge
                ? "Thank you for supporting FIT Dashboard!"
                : "Enter your code to activate."}
            </p>
            {supporterBadge && (
              <div className="supporter-badge-row">
                <span className="supporter-badge-inline" title="Supporter Badge Active">Supporter</span>
              </div>
            )}
          </div>
          {!supporterBadge ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Code..."
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
                  {verifying ? "..." : "Verify"}
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
              Remove badge
            </button>
          )}
        </div>

        <div className="storage-box">
          <strong>Storage Locations</strong>
          {storageInfo ? (
            <div className="storage-meta">
              <div>
                <span>App version:</span> <code>{appVersion}</code>
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
                    onClick={openExternalLink}
                  >
                    Update to {versionBadgeStatus.latestVersion}
                  </a>
                )}
              </div>
              <div><span>App data:</span> <code>{storageInfo.data_dir}</code></div>
              <div><span>Database:</span> <code>{storageInfo.db_path}</code></div>
              <div><span>FIT files:</span> <code>{storageInfo.fit_files_dir}</code></div>
            </div>
          ) : (
            <p className="small">Unable to load storage path details right now.</p>
          )}

          <div style={{ marginTop: "0.7rem", display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-start" }}>
            <span className="small">
              Blacklisted hashes: <strong>{blacklistCount ?? "-"}</strong>
            </span>
            <button
              className="btn-danger"
              onClick={() => void handleClearBlacklist()}
              disabled={clearingBlacklist}
            >
              {clearingBlacklist ? "Clearing..." : "Clear Blacklist"}
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
      </div>
    </div>
  );
}
