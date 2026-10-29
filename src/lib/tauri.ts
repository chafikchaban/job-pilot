import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

export function openExternal(url: string) {
  open(url).catch((err) => {
    console.error("Failed to open external URL:", err);
    window.open(url, "_blank");
  });
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

export interface SettingEntry {
  key: string;
  value: string;
}

export async function getAllSettings(): Promise<SettingEntry[]> {
  return invoke<SettingEntry[]>("get_all_settings");
}
