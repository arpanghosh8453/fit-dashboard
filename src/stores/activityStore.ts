import { create } from "zustand";
import type { Activity, OverviewStats, RecordPoint } from "../types";
import { api } from "../lib/api";

type ActivityState = {
  activities: Activity[];
  selectedActivity: Activity | null;
  overview: OverviewStats | null;
  records: RecordPoint[];
  loading: boolean;
  filterSport: string;
  setFilterSport: (sport: string) => void;
  refresh: () => Promise<void>;
  selectActivity: (activity: Activity | null) => Promise<void>;
};

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  selectedActivity: null,
  overview: null,
  records: [],
  loading: false,
  filterSport: "all",

  setFilterSport: (sport) => set({ filterSport: sport }),

  async refresh() {
    set({ loading: true });
    try {
      const [activities, overview] = await Promise.all([api.listActivities(), api.getOverview()]);
      set({ activities, overview });

      if (get().selectedActivity) {
        const id = get().selectedActivity!.id;
        const records = await api.getRecords(id);
        set({ records });
      }
    } finally {
      set({ loading: false });
    }
  },

  async selectActivity(activity) {
    set({ selectedActivity: activity, records: [] });
    if (!activity) {
      return;
    }
    const records = await api.getRecords(activity.id);
    set({ records });
  }
}));
