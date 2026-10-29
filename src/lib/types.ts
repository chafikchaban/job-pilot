import { z } from "zod";

export const RemotePolicySchema = z.enum(["remote", "hybrid", "onsite"]);
export type RemotePolicy = z.infer<typeof RemotePolicySchema>;

export const JobStatusSchema = z.enum([
  "interested",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.number(),
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  remote_policy: RemotePolicySchema.nullable(),
  description: z.string().nullable(),
  url: z.string(),
  apply_url: z.string().nullable(),
  source: z.string(),
  language: z.string().nullable(),
  german_level_required: z.string().nullable(),
  posted_at: z.string().nullable(),
  fetched_at: z.string().nullable(),
  relevance_score: z.number().nullable(),
  match_reason: z.string().nullable().optional(),
  ai_scored: z.number().nullable().optional(),
  parsed_info: z.string().nullable().optional(),
  scan_id: z.number().nullable().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export interface ParsedJobInfo {
  core_skills: string[];
  nice_to_have_skills: string[];
  benefits: string[];
  responsibilities: string[];
  interview_process: string[];
  salary_range: string | null;
  seniority_level: string | null;
  experience_years: string | null;
  contract_type: string | null;
}

export const ApplicationSchema = z.object({
  id: z.number(),
  job_id: z.number(),
  status: JobStatusSchema,
  applied_at: z.string().nullable(),
  notes: z.string().nullable(),
  follow_up_date: z.string().nullable(),
  cover_letter_id: z.number().nullable(),
  updated_at: z.string().nullable(),
});
export type Application = z.infer<typeof ApplicationSchema>;

export const CoverLetterSchema = z.object({
  id: z.number(),
  job_id: z.number(),
  content: z.string(),
  language: z.string(),
  tone: z.string(),
  generated_at: z.string(),
  edited_at: z.string().nullable(),
});
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

export interface JobFilters {
  search?: string;
  sources?: string[];
  remote_policy?: string[];
  min_relevance?: number;
  language?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  per_page?: number;
}

export interface SourceResult {
  source: string;
  found: number;
  new: number;
  error: string | null;
}

export interface PipelineStats {
  fetched: number;
  deduped: number;
  prefilter_passed: number;
  ai_evaluated: number;
  ai_passed: number;
  inserted: number;
}

export interface ScanSummary {
  total_found: number;
  new_inserted: number;
  errors: string[];
  source_results: SourceResult[];
  pipeline_stats: PipelineStats | null;
}

export interface AnalyticsData {
  total_jobs_discovered: number;
  total_applications: number;
  applications_by_status: Record<string, number>;
  jobs_by_source: Record<string, number>;
  applications_by_week: { week: string; count: number }[];
  response_rate: number;
  avg_relevance_score: number;
  scans_last_30_days: number;
  jobs_last_30_days: number;
}

export interface ResumeData {
  id: number;
  file_name: string | null;
  parsed_json: string | null;
  target_roles: string | null;
  updated_at: string | null;
}

export interface ApplicationWithJob {
  id: number;
  job_id: number;
  status: string;
  applied_at: string | null;
  notes: string | null;
  follow_up_date: string | null;
  cover_letter_id: number | null;
  updated_at: string | null;
  job_title: string;
  job_company: string | null;
  job_url: string;
}

export interface CoverLetterData {
  id: number;
  job_id: number;
  content: string;
  language: string;
  tone: string;
  generated_at: string;
  edited_at: string | null;
}

export interface ScanLogEntry {
  id: number;
  source: string;
  jobs_found: number;
  jobs_new: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface ScanSession {
  id: number;
  started_at: string;
  completed_at: string | null;
  total_found: number;
  new_inserted: number;
  pipeline_stats: string | null;
  errors: string | null;
  status: "running" | "completed" | "failed";
  source_results: ScanLogEntry[];
}
