import { useSettingsStore } from "../stores/settingsStore";

export function SettingsPanel() {
  const {
    showSettings,
    theme,
    distanceUnit,
    dateFormat,
    timeFormat,
    mapStyle,
    supporterBadge,
    setTheme,
    setDistanceUnit,
    setDateFormat,
    setTimeFormat,
    setMapStyle,
    buySupporterBadge,
    toggleSettings
  } = useSettingsStore();

  if (!showSettings) {
    return null;
  }

  return (
    <div className="settings-overlay">
      <div className="settings-backdrop" onClick={toggleSettings} />
      <div className="settings-drawer">
        <div className="settings-drawer-header">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={toggleSettings} aria-label="Close settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-grid">
          <label>
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark")}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <label>
            Distance Unit
            <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as "km" | "mi")}>
              <option value="km">Kilometers</option>
              <option value="mi">Miles</option>
            </select>
          </label>

          <label>
            Date Format
            <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as "locale" | "iso")}>
              <option value="locale">Locale</option>
              <option value="iso">ISO</option>
            </select>
          </label>

          <label>
            Time Format
            <select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as "12h" | "24h")}>
              <option value="12h">12h</option>
              <option value="24h">24h</option>
            </select>
          </label>

          <label>
            Map Style
            <select value={mapStyle} onChange={(e) => setMapStyle(e.target.value as "street" | "topo" | "satellite" | "dark")}>
              <option value="street">Street</option>
              <option value="topo">Topo</option>
              <option value="satellite">Satellite</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>

        <div className="supporter-box">
          <div>
            <strong>Supporter Badge</strong>
            <p className="small">Get a supporter badge and help development.</p>
          </div>
          <button
            className="btn-primary"
            onClick={buySupporterBadge}
            disabled={supporterBadge}
          >
            {supporterBadge ? "Purchased" : "Buy Badge"}
          </button>
        </div>
      </div>
    </div>
  );
}
