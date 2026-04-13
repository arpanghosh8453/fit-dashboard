import { create } from "zustand";

type Theme = "light" | "dark";
type DistanceUnit = "km" | "mi";
type DateFormat = "locale" | "iso";
type TimeFormat = "12h" | "24h";
export type MapStyle = "street" | "topo" | "satellite" | "dark";

type SettingsState = {
  theme: Theme;
  distanceUnit: DistanceUnit;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  mapStyle: MapStyle;
  supporterBadge: boolean;
  showSettings: boolean;
  hydrate: () => void;
  toggleSettings: () => void;
  setTheme: (theme: Theme) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setDateFormat: (format: DateFormat) => void;
  setTimeFormat: (format: TimeFormat) => void;
  setMapStyle: (style: MapStyle) => void;
  buySupporterBadge: () => void;
};

const STORAGE_KEY = "fitDashboard.settings";

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "light",
  distanceUnit: "km",
  dateFormat: "locale",
  timeFormat: "24h",
  mapStyle: "street",
  supporterBadge: false,
  showSettings: false,

  hydrate: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      set({
        theme: parsed.theme ?? "light",
        distanceUnit: parsed.distanceUnit ?? "km",
        dateFormat: parsed.dateFormat ?? "locale",
        timeFormat: parsed.timeFormat ?? "24h",
        mapStyle: parsed.mapStyle ?? "street",
        supporterBadge: Boolean(parsed.supporterBadge)
      });
    } catch {
      // Ignore invalid persisted data.
    }
  },

  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),

  setTheme: (theme) => {
    set({ theme });
    persist(get());
  },

  setDistanceUnit: (distanceUnit) => {
    set({ distanceUnit });
    persist(get());
  },

  setDateFormat: (dateFormat) => {
    set({ dateFormat });
    persist(get());
  },

  setTimeFormat: (timeFormat) => {
    set({ timeFormat });
    persist(get());
  },

  setMapStyle: (mapStyle) => {
    set({ mapStyle });
    persist(get());
  },

  buySupporterBadge: () => {
    set({ supporterBadge: true });
    persist(get());
  }
}));

function persist(state: SettingsState) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      theme: state.theme,
      distanceUnit: state.distanceUnit,
      dateFormat: state.dateFormat,
      timeFormat: state.timeFormat,
      mapStyle: state.mapStyle,
      supporterBadge: state.supporterBadge
    })
  );
}
