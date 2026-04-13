import axios from "axios";
import { invoke } from "@tauri-apps/api/core";
import type { Activity, OverviewStats, RecordPoint } from "../types";

type StorageInfo = {
  data_dir: string;
  db_path: string;
  fit_files_dir: string;
};

type SyncSummary = {
  scanned: number;
  imported: number;
  duplicates: number;
  blacklisted: number;
  failed: number;
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const base = (import.meta.env.VITE_API_BASE ?? "http://localhost:8080").replace(/\/$/, "");

const SESSION_KEY = "sessionToken";
const SESSION_TS_KEY = "sessionTokenTs";
const SESSION_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

function getStoredSession(): string | null {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return null;
  // Desktop (Tauri) tokens never expire — user logs out manually
  if (isTauri) return token;
  const ts = localStorage.getItem(SESSION_TS_KEY);
  if (!ts) return null;
  if (Date.now() - Number(ts) > SESSION_TTL_MS) {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_TS_KEY);
    return null;
  }
  return token;
}

let sessionToken: string | null = getStoredSession();

const webClient = axios.create({
  baseURL: `${base}/api`
});

webClient.interceptors.request.use((config) => {
  if (sessionToken) {
    config.headers["X-Session"] = sessionToken;
  }
  return config;
});

export const api = {
  setSession(token: string | null) {
    sessionToken = token;
    if (token) {
      localStorage.setItem(SESSION_KEY, token);
      if (!localStorage.getItem(SESSION_TS_KEY)) {
        localStorage.setItem(SESSION_TS_KEY, String(Date.now()));
      }
    } else {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_TS_KEY);
    }
  },

  getStoredSession,

  async status(): Promise<{ needs_onboarding: boolean }> {
    if (isTauri) {
      return invoke("status");
    }
    const res = await webClient.get("/status");
    return res.data;
  },

  async onboard(username: string, password: string) {
    if (isTauri) {
      return invoke<{ token: string }>("onboard", { username, password });
    }
    const res = await webClient.post("/onboard", { username, password });
    return res.data;
  },

  async unlock(password: string) {
    if (isTauri) {
      return invoke<{ token: string }>("unlock", { password });
    }
    const res = await webClient.post("/unlock", { password });
    return res.data;
  },

  async logout() {
    if (isTauri) {
      await invoke("logout");
      return;
    }
    await webClient.post("/logout");
  },

  async importFit(file: File) {
    if (isTauri) {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      return invoke("import_fit_bytes", { fileName: file.name, bytes });
    }

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await webClient.post("/import-fit", fd);
      return res.data as { status: "ok" | "duplicate"; activity_id?: number };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new Error("network error: backend unreachable or upload rejected by size limit");
        }
        const details = (error.response?.data as { error?: string } | undefined)?.error;
        throw new Error(details ?? error.message);
      }
      throw error;
    }
  },

  async syncFitFiles(): Promise<SyncSummary> {
    if (isTauri) {
      return invoke<SyncSummary>("sync_fit_files");
    }
    const res = await webClient.post("/sync-fit-files");
    return res.data;
  },

  async getStorageInfo(): Promise<StorageInfo> {
    if (isTauri) {
      return invoke<StorageInfo>("get_storage_info");
    }
    const res = await webClient.get("/storage-info");
    return res.data;
  },

  async listActivities(): Promise<Activity[]> {
    if (isTauri) {
      return invoke("list_activities");
    }
    const res = await webClient.get("/activities");
    return res.data;
  },

  async getOverview(): Promise<OverviewStats> {
    if (isTauri) {
      return invoke("get_overview");
    }
    const res = await webClient.get("/overview");
    return res.data;
  },

  async getRecords(activityId: number, resolutionMs = 10000): Promise<RecordPoint[]> {
    if (isTauri) {
      return invoke("get_records", { activityId, resolutionMs });
    }
    const res = await webClient.get(`/records/${activityId}`, {
      params: { resolution_ms: resolutionMs }
    });
    return res.data;
  },

  async renameActivity(activityId: number, name: string) {
    if (isTauri) {
      return invoke("rename_activity", { activityId, name });
    }
    await webClient.patch(`/activities/${activityId}`, { name });
  },

  async deleteActivity(activityId: number) {
    if (isTauri) {
      return invoke("delete_activity", { activityId });
    }
    await webClient.delete(`/activities/${activityId}`);
  },

  async verifySupporterCode(code: string): Promise<boolean> {
    if (isTauri) {
      return invoke<boolean>("verify_supporter_code", { code });
    }
    const res = await webClient.post("/supporter/verify", { code });
    return res.data;
  },

  async getSupporterStatus(): Promise<boolean> {
    if (isTauri) {
      return invoke<boolean>("get_supporter_status");
    }
    const res = await webClient.get("/supporter/status");
    return res.data;
  },

  async setSupporterStatus(active: boolean): Promise<boolean> {
    if (isTauri) {
      return invoke<boolean>("set_supporter_status", { active });
    }
    const res = await webClient.post("/supporter/status", { active });
    return res.data;
  },

  async getDonationDismissed(): Promise<boolean> {
    if (isTauri) {
      return invoke<boolean>("get_donation_dismissed");
    }
    const res = await webClient.get("/supporter/donation");
    return res.data;
  },

  async setDonationDismissed(dismissed: boolean): Promise<boolean> {
    if (isTauri) {
      return invoke<boolean>("set_donation_dismissed", { dismissed });
    }
    const res = await webClient.post("/supporter/donation", { dismissed });
    return res.data;
  }
};
