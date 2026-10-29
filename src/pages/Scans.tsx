import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Activity,
} from "lucide-react";
import type { ScanSession, PipelineStats } from "../lib/types";

export function Scans() {
  const scans = useQuery<ScanSession[]>({
    queryKey: ["scans"],
    queryFn: () => invoke<ScanSession[]>("get_scans", { limit: 50 }),
  });

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (scans.isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading scans...
      </div>
    );
  }

  if (scans.isError) {
    return (
      <div className="flex items-center gap-2 text-red-600">
        <AlertCircle className="h-5 w-5" />
        Failed to load scan history.
      </div>
    );
  }

  const data = scans.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Scans</h1>

      {data.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          <Activity className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm">No scans yet. Run a scan from the Dashboard.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((scan) => (
            <ScanRow
              key={scan.id}
              scan={scan}
              isExpanded={expanded.has(scan.id)}
              onToggle={() => toggle(scan.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <AlertCircle className="h-3 w-3" />
          Failed
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {status}
        </span>
      );
  }
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "--";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function ScanRow({
  scan,
  isExpanded,
  onToggle,
}: {
  scan: ScanSession;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const errors: string[] = scan.errors ? JSON.parse(scan.errors) : [];
  const pipelineStats: PipelineStats | null = scan.pipeline_stats
    ? JSON.parse(scan.pipeline_stats)
    : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-900">
              Scan #{scan.id}
            </span>
            <StatusBadge status={scan.status} />
            {errors.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {errors.length} error{errors.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {new Date(scan.started_at).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-6 text-sm shrink-0">
          <div className="text-center">
            <p className="font-semibold text-gray-900">{scan.total_found}</p>
            <p className="text-xs text-gray-500">Found</p>
          </div>
          <div className="text-center">
            <p className="font-semibold text-green-600">+{scan.new_inserted}</p>
            <p className="text-xs text-gray-500">New</p>
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-700">
              {formatDuration(scan.started_at, scan.completed_at)}
            </p>
            <p className="text-xs text-gray-500">Duration</p>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {/* Pipeline funnel */}
          {pipelineStats && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Pipeline
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-gray-200 px-2 py-0.5 text-gray-700">
                  {pipelineStats.fetched} fetched
                </span>
                <span className="text-gray-400">&rarr;</span>
                <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800">
                  {pipelineStats.prefilter_passed} pre-filtered
                </span>
                <span className="text-gray-400">&rarr;</span>
                {pipelineStats.ai_evaluated > 0 && (
                  <>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">
                      {pipelineStats.ai_passed} AI-passed
                    </span>
                    <span className="text-gray-400">&rarr;</span>
                  </>
                )}
                <span className="rounded bg-green-200 px-2 py-0.5 font-medium text-green-800">
                  {pipelineStats.inserted} inserted
                </span>
              </div>
            </div>
          )}

          {/* Source breakdown */}
          {scan.source_results.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Sources
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-1.5 font-medium">Source</th>
                    <th className="pb-1.5 font-medium">Found</th>
                    <th className="pb-1.5 font-medium">New</th>
                    <th className="pb-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.source_results.map((sr) => (
                    <tr key={sr.id} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium text-gray-800">
                        {sr.source}
                      </td>
                      <td className="py-1.5">{sr.jobs_found}</td>
                      <td className="py-1.5 text-green-600">+{sr.jobs_new}</td>
                      <td className="py-1.5">
                        {sr.error ? (
                          <span className="text-red-500 text-xs">{sr.error}</span>
                        ) : (
                          <span className="text-green-600 text-xs">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Errors
              </h3>
              <ul className="space-y-1">
                {errors.map((err, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-red-600"
                  >
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
