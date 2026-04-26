import { open } from "@tauri-apps/plugin-shell";

export async function openExternalLink(e: React.MouseEvent<HTMLAnchorElement>) {
  if ("__TAURI_INTERNALS__" in window) {
    e.preventDefault();
    e.stopPropagation();
    const href = e.currentTarget.href;
    try {
      await open(href);
    } catch (err) {
      console.error("Failed to open external link natively:", err);
    }
  }
}
