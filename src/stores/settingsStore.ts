import { create } from "zustand";
import { api } from "../lib/api";

type Theme = "light" | "dark";
type DistanceUnit = "km" | "mi";
type DateFormat = "locale" | "iso";
type TimeFormat = "12h" | "24h";
export type MapStyle = "default" | "openstreet" | "topo" | "satellite";

type SettingsState = {
  theme: Theme;
  distanceUnit: DistanceUnit;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  mapStyle: MapStyle;
  supporterBadge: boolean;
  donationDismissed: boolean;
  showSettings: boolean;
  hydrate: () => void;
  toggleSettings: () => void;
  setTheme: (theme: Theme) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setDateFormat: (format: DateFormat) => void;
  setTimeFormat: (format: TimeFormat) => void;
  setMapStyle: (style: MapStyle) => void;
  loadSupporterStatus: () => Promise<void>;
  verifySupporterCode: (code: string) => Promise<boolean>;
  removeSupporterBadge: () => Promise<void>;
  dismissDonationBanner: () => void;
};

const STORAGE_KEY = "fitDashboard.settings";

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "light",
  distanceUnit: "km",
  dateFormat: "locale",
  timeFormat: "24h",
  mapStyle: "default",
  supporterBadge: false,
  donationDismissed: false,
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
        mapStyle: parsed.mapStyle ?? "default",
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

  loadSupporterStatus: async () => {
    try {
      const [badgeActive, dismissed] = await Promise.all([
        api.getSupporterStatus(),
        api.getDonationDismissed(),
      ]);
      set({ supporterBadge: badgeActive, donationDismissed: dismissed });
    } catch (err) {
      console.warn("Failed to load supporter status from backend:", err);
    }
  },

  verifySupporterCode: async (code: string) => {
    try {
      const valid = await api.verifySupporterCode(code);
      if (valid) {
        set({ supporterBadge: true, donationDismissed: true });
      }
      return valid;
    } catch (err) {
      console.error("Failed to verify supporter code:", err);
      return false;
    }
  },

  removeSupporterBadge: async () => {
    try {
      await Promise.all([
        api.setSupporterStatus(false),
        api.setDonationDismissed(false),
      ]);
      set({ supporterBadge: false, donationDismissed: false });
    } catch (err) {
      console.error("Failed to remove supporter badge:", err);
    }
  },

  dismissDonationBanner: () => {
    set({ donationDismissed: true });
    api.setDonationDismissed(true).catch((err) =>
      console.warn("Failed to persist donation dismissed state:", err)
    );
  },
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
    })
  );
}
