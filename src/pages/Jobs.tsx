import { useState, useMemo } from "react";
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  RefreshCw,
  ExternalLink,
  MapPin,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Check,
} from "lucide-react";
import { useJobs, useScanJobs } from "../hooks/useJobs";
import { useResume } from "../hooks/useResume";
import { useGenerateCoverLetter } from "../hooks/useCoverLetters";
import { JobDetailModal } from "../components/JobDetailModal";
import { formatPostedDate } from "../lib/job-parser";
import { openExternal } from "../lib/tauri";
import type { Job, JobFilters } from "../lib/types";

const SOURCES = ["adzuna", "themuse", "remotive", "arbeitnow", "jsearch", "linkedin", "stepstone", "brave_search"];
const REMOTE_OPTIONS = ["remote", "hybrid", "onsite"] as const;
const SORT_OPTIONS = [
  { value: "relevance_score", label: "Relevance" },
  { value: "posted_at", label: "Date Posted" },
  { value: "title", label: "Title" },
];
const PER_PAGE = 20;

export function Jobs() {
  const [search, setSearch] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [remotePolicies, setRemotePolicies] = useState<string[]>([]);
  const [minRelevance, setMinRelevance] = useState(0);
  const [sortBy, setSortBy] = useState("posted_at");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const filters: JobFilters = {
    search: search || undefined,
    sources: selectedSources.length ? selectedSources : undefined,
    remote_policy: remotePolicies.length ? remotePolicies : undefined,
    min_relevance: minRelevance > 0 ? minRelevance : undefined,
    sort_by: sortBy,
    sort_order: "desc",
    page,
    per_page: PER_PAGE,
  };

  const { data: jobs = [], isLoading } = useJobs(filters);
  const scan = useScanJobs();
  const { data: resume } = useResume();
  const generate = useGenerateCoverLetter();
  const [generatingJobId, setGeneratingJobId] = useState<number | null>(null);
  const [generatedJobIds, setGeneratedJobIds] = useState<Set<number>>(new Set());
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerate = (jobId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setGeneratingJobId(jobId);
    setGenerateError(null);
    generate.mutate(
      { jobId, language: "en", tone: "professional" },
      {
        onSuccess: () => {
          setGeneratedJobIds((prev) => new Set(prev).add(jobId));
          setGeneratingJobId(null);
        },
        onError: (err) => {
          setGeneratingJobId(null);
          setGenerateError(String(err));
        },
      }
    );
  };

  const userSkills = useMemo(() => {
    if (!resume?.parsed_json) return [];
    try {
      const parsed = JSON.parse(resume.parsed_json);
      return (parsed.skills as string[]) ?? [];
    } catch {
      return [];
    }
  }, [resume?.parsed_json]);

  const toggleSource = (s: string) =>
    setSelectedSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  const toggleRemote = (r: string) =>
    setRemotePolicies((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
        <button
          onClick={() => scan.mutate(null)}
          disabled={scan.isPending}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
          {scan.isPending ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {scan.isSuccess && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          Scan complete: {scan.data.total_found} found, {scan.data.new_inserted} new.
        </div>
      )}

      {generateError && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <span>Cover letter generation failed: {generateError}</span>
          <button onClick={() => setGenerateError(null)} className="ml-2 font-medium hover:underline">Dismiss</button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <SlidersHorizontal className="h-4 w-4 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-gray-300">
            <button
              onClick={() => setViewMode("card")}
              className={`p-2 ${viewMode === "card" ? "bg-gray-100" : ""}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-2 ${viewMode === "table" ? "bg-gray-100" : ""}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Sources:</span>
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => { toggleSource(s); setPage(1); }}
              className={`rounded-full px-3 py-1 font-medium ${
                selectedSources.includes(s)
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s}
            </button>
          ))}
          <span className="ml-3 text-gray-500">Remote:</span>
          {REMOTE_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => { toggleRemote(r); setPage(1); }}
              className={`rounded-full px-3 py-1 font-medium ${
                remotePolicies.includes(r)
                  ? "bg-purple-100 text-purple-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {r}
            </button>
          ))}
          <span className="ml-3 text-gray-500">Min Relevance:</span>
          <input
            type="range"
            min={0}
            max={100}
            value={minRelevance}
            onChange={(e) => { setMinRelevance(Number(e.target.value)); setPage(1); }}
            className="w-24"
          />
          <span className="text-gray-700">{minRelevance}</span>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : viewMode === "card" ? (
        <div className="grid grid-cols-2 gap-4">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onClick={() => setSelectedJob(job)}
              onGenerate={handleGenerate}
              isGenerating={generatingJobId === job.id}
              isGenerated={generatedJobIds.has(job.id)}
            />
          ))}
        </div>
      ) : (
        <JobTable
          jobs={jobs}
          onSelect={setSelectedJob}
          onGenerate={handleGenerate}
          generatingJobId={generatingJobId}
          generatedJobIds={generatedJobIds}
        />
      )}

      {jobs.length === 0 && !isLoading && (
        <p className="py-12 text-center text-gray-400">No jobs found. Try adjusting filters or run a scan.</p>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <span className="text-sm text-gray-600">Page {page}</span>
        <button
          disabled={jobs.length < PER_PAGE}
          onClick={() => setPage((p) => p + 1)}
          className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Job Detail Modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          userSkills={userSkills}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}

function JobCard({
  job,
  onClick,
  onGenerate,
  isGenerating,
  isGenerated,
}: {
  job: Job;
  onClick: () => void;
  onGenerate: (jobId: number, e: React.MouseEvent) => void;
  isGenerating: boolean;
  isGenerated: boolean;
}) {
  const score = job.relevance_score ?? 0;
  const posted = formatPostedDate(job.posted_at);
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 transition hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between">
        <h3 className="font-semibold text-gray-900 leading-tight">{job.title}</h3>
        <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          score >= 70 ? "bg-green-100 text-green-700" : score >= 40 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
        }`}>
          {score.toFixed(0)}%
        </span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {job.company && (
          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{job.company}</span>
        )}
        {job.location && (
          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location}</span>
        )}
        {posted.relative && (
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{posted.full}</span>
        )}
        {job.remote_policy && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">{job.remote_policy}</span>
        )}
        <span className="rounded-full bg-gray-100 px-2 py-0.5">{job.source}</span>
      </div>
      {job.match_reason && (
        <p className="mb-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
          {job.match_reason}
        </p>
      )}
      {!job.match_reason && job.description && (
        <p className="mb-3 line-clamp-2 text-xs text-gray-500">{job.description}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); openExternal(job.url); }}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
        >
          View Listing <ExternalLink className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => onGenerate(job.id, e)}
          disabled={isGenerating}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
            isGenerated
              ? "bg-green-50 text-green-600"
              : "bg-purple-50 text-purple-600 hover:bg-purple-100"
          } disabled:opacity-50`}
        >
          {isGenerating ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
          ) : isGenerated ? (
            <><Check className="h-3 w-3" /> Generated</>
          ) : (
            <><FileText className="h-3 w-3" /> Cover Letter</>
          )}
        </button>
      </div>
    </div>
  );
}

function JobTable({
  jobs,
  onSelect,
  onGenerate,
  generatingJobId,
  generatedJobIds,
}: {
  jobs: Job[];
  onSelect: (job: Job) => void;
  onGenerate: (jobId: number, e: React.MouseEvent) => void;
  generatingJobId: number | null;
  generatedJobIds: Set<number>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-gray-500">
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Company</th>
            <th className="px-4 py-2 font-medium">Location</th>
            <th className="px-4 py-2 font-medium">Published</th>
            <th className="px-4 py-2 font-medium">Remote</th>
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium">Score</th>
            <th className="px-4 py-2 font-medium">Cover</th>
            <th className="px-4 py-2 font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const posted = formatPostedDate(job.posted_at);
            const isGenerating = generatingJobId === job.id;
            const isGenerated = generatedJobIds.has(job.id);
            return (
              <tr
                key={job.id}
                onClick={() => onSelect(job)}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
              >
                <td className="px-4 py-2 font-medium text-gray-900">{job.title}</td>
                <td className="px-4 py-2 text-gray-600">{job.company ?? "--"}</td>
                <td className="px-4 py-2 text-gray-600">{job.location ?? "--"}</td>
                <td className="px-4 py-2 text-gray-500">
                  {posted.relative ? (
                    <span>
                      <span className="text-gray-400">({posted.relative})</span>{" "}
                      {posted.absolute}
                    </span>
                  ) : (
                    "--"
                  )}
                </td>
                <td className="px-4 py-2">{job.remote_policy ?? "--"}</td>
                <td className="px-4 py-2">{job.source}</td>
                <td className="px-4 py-2">{(job.relevance_score ?? 0).toFixed(0)}%</td>
                <td className="px-4 py-2">
                  <button
                    onClick={(e) => onGenerate(job.id, e)}
                    disabled={isGenerating}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                      isGenerated
                        ? "bg-green-50 text-green-600"
                        : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                    } disabled:opacity-50`}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isGenerated ? (
                      <><Check className="h-3 w-3" /> Done</>
                    ) : (
                      <><FileText className="h-3 w-3" /> Generate</>
                    )}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); openExternal(job.url); }}
                    className="text-blue-600 hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
