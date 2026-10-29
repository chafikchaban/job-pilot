import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { CoverLetterData } from "../lib/types";

export function useCoverLetters(jobId?: number | null) {
  return useQuery<CoverLetterData[]>({
    queryKey: ["cover_letters", jobId],
    queryFn: () =>
      invoke<CoverLetterData[]>("get_cover_letters", { job_id: jobId ?? null }),
  });
}

export function useGenerateCoverLetter() {
  const qc = useQueryClient();
  return useMutation<
    CoverLetterData,
    string,
    { jobId: number; language: string; tone: string }
  >({
    mutationFn: ({ jobId, language, tone }) =>
      invoke<CoverLetterData>("generate_cover_letter", { job_id: jobId, language, tone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cover_letters"] });
    },
  });
}

export function useUpdateCoverLetter() {
  const qc = useQueryClient();
  return useMutation<void, string, { id: number; content: string }>({
    mutationFn: ({ id, content }) =>
      invoke("update_cover_letter", { id, content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cover_letters"] });
    },
  });
}

export function useDeleteCoverLetter() {
  const qc = useQueryClient();
  return useMutation<void, string, number>({
    mutationFn: (id) => invoke("delete_cover_letter", { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cover_letters"] });
    },
  });
}
