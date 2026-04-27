import { create } from "zustand";
import { api } from "../lib/api";

type Theme = "light" | "dark";
type DistanceUnit = "km" | "mi";
type TimeFormat = "12h" | "24h";
export type MapStyle = "default" | "light" | "dark" | "openstreet" | "topo" | "satellite";

type SettingsState = {
  theme: Theme;
  distanceUnit: DistanceUnit;
  timeFormat: TimeFormat;
  mapStyle: MapStyle;
  overviewTableDays: number;
  supporterBadge: boolean;
  donationDismissed: boolean;
  showSettings: boolean;
  hydrate: () => void;
  toggleSettings: () => void;
  setTheme: (theme: Theme) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setTimeFormat: (format: TimeFormat) => void;
  setMapStyle: (style: MapStyle) => void;
  setOverviewTableDays: (days: number) => void;
  loadSupporterStatus: () => Promise<void>;
  verifySupporterCode: (code: string) => Promise<boolean>;
  removeSupporterBadge: () => Promise<void>;
  dismissDonationBanner: () => void;
};

const STORAGE_KEY = "fitDashboard.settings";

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "light",
  distanceUnit: "km",
  timeFormat: "24h",
  mapStyle: "default",
  overviewTableDays: 7,
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
        timeFormat: parsed.timeFormat ?? "24h",
        mapStyle: parsed.mapStyle ?? "default",
        overviewTableDays: Number.isFinite(parsed.overviewTableDays) ? Math.max(1, Math.round(parsed.overviewTableDays)) : 7,
      });
    } catch {
      // Ignore invalid persisted data.
    }
  },

  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),

  setTheme: (theme) => {
    set({ theme });
    persist({ ...get(), theme });
  },

  setDistanceUnit: (distanceUnit) => {
    set({ distanceUnit });
    persist({ ...get(), distanceUnit });
  },

  setTimeFormat: (timeFormat) => {
    set({ timeFormat });
    persist({ ...get(), timeFormat });
  },

  setMapStyle: (mapStyle) => {
    set({ mapStyle });
    persist({ ...get(), mapStyle });
  },

  setOverviewTableDays: (overviewTableDays) => {
    const clampedDays = Math.max(1, Math.round(overviewTableDays));
    set({ overviewTableDays: clampedDays });
    persist({ ...get(), overviewTableDays: clampedDays });
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
      timeFormat: state.timeFormat,
      mapStyle: state.mapStyle,
      overviewTableDays: state.overviewTableDays,
    })
  );
}
