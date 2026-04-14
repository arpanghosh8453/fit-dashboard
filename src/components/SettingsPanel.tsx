import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { api } from "../lib/api";

type StorageInfo = {
  data_dir: string;
  db_path: string;
  fit_files_dir: string;
};

export function SettingsPanel() {
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
