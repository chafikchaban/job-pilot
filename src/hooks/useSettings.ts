import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAllSettings, setSetting, type SettingEntry } from "../lib/tauri";

export function useSettings() {
  return useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: async () => {
      const entries: SettingEntry[] = await getAllSettings();
      const map: Record<string, string> = {};
      for (const e of entries) {
        map[e.key] = e.value;
      }
      return map;
    },
  });
}

export function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation<void, string, { key: string; value: string }>({
    mutationFn: ({ key, value }) => setSetting(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
