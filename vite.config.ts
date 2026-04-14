import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json";
import tauriConfig from "./src-tauri/tauri.conf.json";

const appVersion = tauriConfig.version ?? packageJson.version;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5173
  }
});
