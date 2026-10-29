import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ResumeData } from "../lib/types";

export function useResume() {
  return useQuery<ResumeData | null>({
    queryKey: ["resume"],
    queryFn: () => invoke<ResumeData | null>("get_resume"),
  });
}

export function useUploadResume() {
  const qc = useQueryClient();
  return useMutation<ResumeData, string, string>({
    mutationFn: (filePath) =>
      invoke<ResumeData>("upload_resume", { filePath }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resume"] });
    },
  });
}

export function useUpdateResumeParsed() {
  const qc = useQueryClient();
  return useMutation<
    void,
    string,
    { parsedJson: string; targetRoles: string }
  >({
    mutationFn: ({ parsedJson, targetRoles }) =>
      invoke("update_resume_parsed", { parsedJson, targetRoles }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resume"] });
    },
  });
}
