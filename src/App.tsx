import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { Onboarding } from "./components/Onboarding";
import { UnlockScreen } from "./components/UnlockScreen";
import { Dashboard } from "./components/Dashboard";
import { useActivityStore } from "./stores/activityStore";
import { useSettingsStore } from "./stores/settingsStore";

type Screen = "loading" | "onboarding" | "unlock" | "dashboard";

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [statusError, setStatusError] = useState<string | null>(null);
  const refresh = useActivityStore((s) => s.refresh);
  const theme = useSettingsStore((s) => s.theme);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  async function resolveStartScreen() {
    try {
      const s = await api.status();
      setStatusError(null);
      if (s.needs_onboarding) {
        setScreen("onboarding");
        return;
      }
      // Auto-login with stored session if not expired
      const storedToken = api.getStoredSession();
      if (storedToken) {
        try {
          api.setSession(storedToken);
          await refresh();
          setScreen("dashboard");
          return;
        } catch {
          // Token expired or invalid on server — clear and show unlock
          api.setSession(null);
        }
      }
      setScreen("unlock");
    } catch {
      setStatusError("Could not reach the backend. Ensure server is running, then retry.");
      setScreen("loading");
    }
  }

  useEffect(() => {
    hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    void resolveStartScreen();
  }, []);

  async function enterDashboard(token: string) {
    api.setSession(token);
    await refresh();
    setScreen("dashboard");
  }

  if (screen === "loading") {
    if (statusError) {
      return (
        <div className="center-screen auth-card stack gap-md">
          <h1>Connection issue</h1>
          <p>{statusError}</p>
          <button type="button" onClick={() => void resolveStartScreen()}>
            Retry
          </button>
        </div>
      );
    }
    return <div className="center-screen">Loading...</div>;
  }

  if (screen === "onboarding") {
    return (
      <div className="center-screen">
        <Onboarding onSubmit={async (u, p) => enterDashboard((await api.onboard(u, p)).token)} />
      </div>
    );
  }

  if (screen === "unlock") {
    return (
      <div className="center-screen">
        <UnlockScreen onSubmit={async (p) => enterDashboard((await api.unlock(p)).token)} />
      </div>
    );
  }

  return <Dashboard onLogout={async () => {
    await api.logout();
    api.setSession(null);
    setScreen("unlock");
  }} />;
}
