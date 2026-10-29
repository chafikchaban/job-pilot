import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Job, JobFilters, ScanSummary } from "../lib/types";

export function useJobs(filters: JobFilters) {
  return useQuery<Job[]>({
    queryKey: ["jobs", filters],
    queryFn: () => invoke<Job[]>("get_jobs", { filters }),
  });
}

export function useJob(id: number | null) {
  return useQuery<Job>({
    queryKey: ["job", id],
    queryFn: () => invoke<Job>("get_job", { id }),
    enabled: id !== null,
  });
}

export function useScanJobs() {
  const qc = useQueryClient();
  return useMutation<ScanSummary, string, string[] | null>({
    mutationFn: (sources) =>
      invoke<ScanSummary>("scan_jobs", { sources }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["scan_history"] });
    },
  });
}
