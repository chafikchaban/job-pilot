import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Briefcase,
  ClipboardList,
  TrendingUp,
  Star,
  RefreshCw,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useScanJobs } from "../hooks/useJobs";
import type { AnalyticsData, ScanLogEntry } from "../lib/types";

export function Dashboard() {
  const analytics = useQuery<AnalyticsData>({
    queryKey: ["analytics"],
    queryFn: () => invoke<AnalyticsData>("get_analytics"),
  });

  const scanHistory = useQuery<ScanLogEntry[]>({
    queryKey: ["scan_history"],
    queryFn: () => invoke<ScanLogEntry[]>("get_scan_history", { limit: 10 }),
  });

  const scan = useScanJobs();

  if (analytics.isLoading) {
    return <DashboardSkeleton />;
  }

  if (analytics.isError) {
    return (
      <div className="flex items-center gap-2 text-red-600">
        <AlertCircle className="h-5 w-5" />
        Failed to load analytics.
      </div>
    );
  }

  const data = analytics.data!;
  const sourceData = Object.entries(data.jobs_by_source).map(([name, value]) => ({
    name,
    count: value,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <button
          onClick={() => scan.mutate(null)}
          disabled={scan.isPending}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {scan.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {scan.isPending ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {/* Scan Result Banner */}
      {scan.isSuccess && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-green-800">Scan complete.</span>{" "}
              <span className="text-green-700">
                Found {scan.data.total_found} jobs, {scan.data.new_inserted} new.
              </span>
            </div>
          </div>

          {/* Pipeline Funnel */}
          {scan.data.pipeline_stats && (
            <div className="ml-8 flex items-center gap-2 text-xs">
              <span className="rounded bg-gray-200 px-2 py-0.5 text-gray-700">
                {scan.data.pipeline_stats.fetched} fetched
              </span>
              <span className="text-gray-400">&rarr;</span>
              <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800">
                {scan.data.pipeline_stats.prefilter_passed} pre-filtered
              </span>
              <span className="text-gray-400">&rarr;</span>
              {scan.data.pipeline_stats.ai_evaluated > 0 ? (
                <>
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">
                    {scan.data.pipeline_stats.ai_passed} AI-passed
                  </span>
                  <span className="text-gray-400">&rarr;</span>
                </>
              ) : null}
              <span className="rounded bg-green-200 px-2 py-0.5 font-medium text-green-800">
                {scan.data.pipeline_stats.inserted} inserted
              </span>
            </div>
          )}

          {/* Per-source breakdown */}
          {scan.data.source_results && scan.data.source_results.length > 0 && (
            <div className="ml-8 grid grid-cols-2 gap-x-6 gap-y-1">
              {scan.data.source_results.map((sr) => (
                <div key={sr.source} className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-gray-700 w-20">{sr.source}</span>
                  {sr.error ? (
                    <span className="text-red-500 truncate">{sr.error}</span>
                  ) : (
                    <span className="text-green-700">
                      {sr.found} found, {sr.new} new
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {scan.isError && (
        <div className="flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">Scan failed: {scan.error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon={<Briefcase className="h-5 w-5 text-blue-600" />}
          label="Total Jobs"
          value={data.total_jobs_discovered}
          bg="bg-blue-50"
        />
        <SummaryCard
          icon={<ClipboardList className="h-5 w-5 text-green-600" />}
          label="Applications"
          value={data.total_applications}
          bg="bg-green-50"
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5 text-purple-600" />}
          label="Response Rate"
          value={`${data.response_rate.toFixed(1)}%`}
          bg="bg-purple-50"
        />
        <SummaryCard
          icon={<Star className="h-5 w-5 text-amber-600" />}
          label="Avg Relevance"
          value={data.avg_relevance_score.toFixed(1)}
          bg="bg-amber-50"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            Applications Over Time
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.applications_by_week}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            Jobs by Source
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sourceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} fontSize={12} />
              <YAxis dataKey="name" type="category" width={90} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Scans */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Recent Scan Activity
        </h2>
        {scanHistory.isLoading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Found</th>
                <th className="pb-2 font-medium">New</th>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(scanHistory.data ?? []).map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="py-2 font-medium text-gray-800">{s.source}</td>
                  <td className="py-2">{s.jobs_found}</td>
                  <td className="py-2 text-green-600">+{s.jobs_new}</td>
                  <td className="py-2 text-gray-500">
                    {s.started_at ? new Date(s.started_at).toLocaleString() : "--"}
                  </td>
                  <td className="py-2">
                    {s.error ? (
                      <span className="text-red-500">Error</span>
                    ) : (
                      <span className="text-green-600">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
      </div>
      <div className="flex items-center gap-2 text-gray-400">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading analytics...
      </div>
    </div>
  );
}
