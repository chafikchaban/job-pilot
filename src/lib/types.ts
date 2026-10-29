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
});
export type Job = z.infer<typeof JobSchema>;

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

export interface ScanSummary {
  total_found: number;
  new_inserted: number;
  errors: string[];
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
