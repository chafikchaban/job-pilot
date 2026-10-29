import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ApplicationWithJob } from "../lib/types";

export function useApplications(statusFilter?: string | null) {
  return useQuery<ApplicationWithJob[]>({
    queryKey: ["applications", statusFilter],
    queryFn: () =>
      invoke<ApplicationWithJob[]>("get_applications", { statusFilter: statusFilter ?? null }),
  });
}

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation<void, string, { jobId: number; status?: string }>({
    mutationFn: ({ jobId, status }) =>
      invoke("create_application", { jobId, status: status ?? "interested" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation<void, string, { id: number; status: string }>({
    mutationFn: ({ id, status }) =>
      invoke("update_application", { id, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useDeleteApplication() {
  const qc = useQueryClient();
  return useMutation<void, string, number>({
    mutationFn: (id) => invoke("delete_application", { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useApplicationStats() {
  return useQuery<Record<string, number>>({
    queryKey: ["application_stats"],
    queryFn: async () => {
      const apps = await invoke<ApplicationWithJob[]>("get_applications", {
        statusFilter: null,
      });
      const counts: Record<string, number> = {};
      for (const a of apps) {
        counts[a.status] = (counts[a.status] ?? 0) + 1;
      }
      return counts;
    },
  });
}
