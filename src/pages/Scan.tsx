import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Activity,
  RefreshCw,
  Trash2,
  ExternalLink,
  Building2,
  MapPin,
  FileText,
  Check,
  X,
  Clock,
  SlidersHorizontal,
  Sparkles,
  Search,
  Calendar,
  Wifi,
  Home,
  Building,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
} from "lucide-react";
import { useScanJobs, useJobsForScan } from "../hooks/useJobs";
import { useSettings, useSaveSetting } from "../hooks/useSettings";
import { useResume } from "../hooks/useResume";
import { useGenerateCoverLetter } from "../hooks/useCoverLetters";
import { JobDetailModal } from "../components/JobDetailModal";
import { openExternal } from "../lib/tauri";
import type { Job, ScanSession, PipelineStats } from "../lib/types";

interface ScanProgressEvent {
  stage: string;
  message: string;
  detail?: string;
  source?: string;
  count?: number;
  total?: number;
}

interface ProgressStep {
  id: string;
  message: string;
  detail?: string;
  status: "pending" | "active" | "done" | "error";
  timestamp: number;
}

const REMOTE_OPTS = ["remote", "hybrid", "onsite"];
const LANG_OPTS = ["en", "de"];
const GERMAN_LEVELS = ["none", "A1", "A2", "B1", "B2", "C1", "C2", "native"];

const POSTED_SINCE_OPTIONS = [
  { label: "24 hours", value: "24h" },
  { label: "3 days", value: "3d" },
  { label: "1 week", value: "1w" },
  { label: "2 weeks", value: "2w" },
  { label: "1 month", value: "1m" },
  { label: "3 months", value: "3m" },
  { label: "6 months", value: "6m" },
];

const SCHEDULE_FREQUENCIES = [
  { label: "Every 6h", cron: (_h: number) => "0 0 */6 * * *" },
  { label: "Every 12h", cron: (_h: number) => "0 0 */12 * * *" },
  { label: "Daily", cron: (h: number) => `0 0 ${h} * * *` },
  { label: "Twice daily", cron: (h: number) => `0 0 ${h},${(h + 10) % 24} * * *` },
];

function parseSchedule(cronValue: string | undefined) {
  if (!cronValue) return { freq: "Daily", hour: 9 };
  if (cronValue.includes("*/6")) return { freq: "Every 6h", hour: 9 };
  if (cronValue.includes("*/12")) return { freq: "Every 12h", hour: 9 };
  const match = cronValue.match(/^0 0 (\d+),(\d+) \* \* \*$/);
  if (match) return { freq: "Twice daily", hour: parseInt(match[1]) };
  const single = cronValue.match(/^0 0 (\d+) \* \* \*$/);
  if (single) return { freq: "Daily", hour: parseInt(single[1]) };
  return { freq: "Daily", hour: 9 };
}

export function Scan() {
  const qc = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const save = useSaveSetting();
  const [local, setLocal] = useState<Record<string, string>>({});

  const scans = useQuery<ScanSession[]>({
    queryKey: ["scans"],
    queryFn: () => invoke<ScanSession[]>("get_scans", { limit: 50 }),
  });

  const scan = useScanJobs();
  const { data: resume } = useResume();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const progressRef = useRef<HTMLDivElement>(null);

  // Listen to scan progress events
  useEffect(() => {
    const unlisten = listen<ScanProgressEvent>("scan-progress", (event) => {
      const data = event.payload;
      setProgressSteps((prev) => {
        const updated = [...prev];

        // Mark previous active steps as done (except source_start which gets matched by source_done)
        if (data.stage !== "source_done" && data.stage !== "source_start") {
          for (const step of updated) {
            if (step.status === "active") step.status = "done";
          }
        }

        // For source_done, mark the matching source_start as done
        if (data.stage === "source_done") {
          const sourceStep = updated.find(
            (s) => s.id.startsWith("source_start_") && s.id.endsWith(`_${data.source}`) && s.status === "active"
          );
          if (sourceStep) {
            sourceStep.status = "done";
            sourceStep.message = data.message;
            sourceStep.detail = data.detail;
          } else {
            // source finished, add it as done
            updated.push({
              id: `source_done_${data.source}_${Date.now()}`,
              message: data.message,
              detail: data.detail,
              status: "done",
              timestamp: Date.now(),
            });
          }
          return updated;
        }

        // For done stage, mark everything done
        if (data.stage === "done") {
          for (const step of updated) {
            if (step.status === "active") step.status = "done";
          }
          updated.push({
            id: `${data.stage}_${Date.now()}`,
            message: data.message,
            detail: data.detail,
            status: "done",
            timestamp: Date.now(),
          });
          return updated;
        }

        updated.push({
          id: `${data.stage}_${data.source ?? ""}_${Date.now()}`,
          message: data.message,
          detail: data.detail,
          status: data.stage.endsWith("_done") || data.stage === "fetched" ? "done" : "active",
          timestamp: Date.now(),
        });

        return updated;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-scroll progress panel
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
    }
  }, [progressSteps]);

  // Clear progress when scan starts
  const handleScan = useCallback(() => {
    setProgressSteps([]);
    scan.mutate(null);
  }, [scan]);

  useEffect(() => {
    if (settings) setLocal(settings);
  }, [settings]);

  const set = (key: string, value: string) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const persist = (key: string) => {
    save.mutate({ key, value: local[key] ?? "" });
  };

  const toggle = (key: string) => {
    const next = local[key] === "true" ? "false" : "true";
    set(key, next);
    save.mutate({ key, value: next });
  };

  const clearScans = useMutation({
    mutationFn: async () => {
      await invoke("delete_all_jobs");
      await invoke("clear_scans");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scans"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs_for_scan"] });
      setExpanded(new Set());
      setSelectedJob(null);
      setShowClearConfirm(false);
    },
  });

  const userSkills = useMemo(() => {
    if (!resume?.parsed_json) return [];
    try {
      const parsed = JSON.parse(resume.parsed_json);
      return (parsed.skills as string[]) ?? [];
    } catch {
      return [];
    }
  }, [resume?.parsed_json]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const data = scans.data ?? [];

  // Count active filters for the badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (local["target_roles"]) count++;
    if (local["preferred_remote_policy"]) count++;
    if (local["regions"]) count++;
    if (local["languages"]) count++;
    if (local["german_level"] && local["german_level"] !== "none") count++;
    if (local["excluded_companies"]) count++;
    if (local["excluded_keywords"]) count++;
    if (local["posted_since"]) count++;
    if (local["ai_filter_enabled"] === "true") count++;
    return count;
  }, [local]);

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* ── Left: Filter Sidebar ── */}
      <div
        className={`shrink-0 overflow-y-auto scan-sidebar transition-all duration-300 ease-in-out ${
          filtersOpen ? "w-72 border-r border-gray-200 opacity-100" : "w-0 opacity-0 overflow-hidden"
        }`}
      >
        <div className="w-72 px-4 pt-2">
          <div className="sticky top-0 bg-gray-50 pb-3 pt-1 z-10">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-800">Scan Filters</h2>
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <button
                onClick={() => setFiltersOpen(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                title="Hide filters"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* Active filter chips */}
            <ActiveFilterChips local={local} set={set} save={save} />
          </div>

          {settingsLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading filters...
            </div>
          ) : (
            <div className="space-y-0.5 pb-6">
            {/* Target Roles */}
            <FilterSection
              title="Target Roles"
              icon={<Search className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("roles")}
              onToggle={() => toggleSection("roles")}
            >
              <input
                value={local["target_roles"] ?? ""}
                onChange={(e) => set("target_roles", e.target.value)}
                onBlur={() => persist("target_roles")}
                placeholder="e.g. Frontend Engineer, React Dev"
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
              />
            </FilterSection>

            {/* Posted Since */}
            <FilterSection
              title="Posted Since"
              icon={<Calendar className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("posted")}
              onToggle={() => toggleSection("posted")}
            >
              <div className="space-y-1">
                {POSTED_SINCE_OPTIONS.map((opt) => (
                  <div
                    key={opt.value}
                    onClick={() => {
                      const val = local["posted_since"] === opt.value ? "" : opt.value;
                      set("posted_since", val);
                      save.mutate({ key: "posted_since", value: val });
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        local["posted_since"] === opt.value
                          ? "border-blue-600 bg-blue-600"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {local["posted_since"] === opt.value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span className={`${local["posted_since"] === opt.value ? "text-gray-900 font-medium" : "text-gray-600"}`}>
                      {opt.label}
                    </span>
                  </div>
                ))}
                {local["posted_since"] && (
                  <button
                    onClick={() => {
                      set("posted_since", "");
                      save.mutate({ key: "posted_since", value: "" });
                    }}
                    className="mt-1 text-[10px] text-blue-600 hover:underline px-2"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </FilterSection>

            {/* Remote Policy */}
            <FilterSection
              title="Remote Policy"
              icon={<MapPin className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("remote")}
              onToggle={() => toggleSection("remote")}
            >
              <div className="space-y-1">
                {REMOTE_OPTS.map((r) => {
                  const current = (local["preferred_remote_policy"] ?? "").split(",").filter(Boolean);
                  const active = current.includes(r);
                  return (
                    <label
                      key={r}
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                          active ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white"
                        }`}
                        onClick={(e) => {
                          e.preventDefault();
                          const next = active ? current.filter((x) => x !== r) : [...current, r];
                          const val = next.filter(Boolean).join(",");
                          set("preferred_remote_policy", val);
                          save.mutate({ key: "preferred_remote_policy", value: val });
                        }}
                      >
                        {active && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span
                        className={`capitalize ${active ? "text-gray-900 font-medium" : "text-gray-600"}`}
                        onClick={() => {
                          const next = active ? current.filter((x) => x !== r) : [...current, r];
                          const val = next.filter(Boolean).join(",");
                          set("preferred_remote_policy", val);
                          save.mutate({ key: "preferred_remote_policy", value: val });
                        }}
                      >
                        {r === "onsite" ? "On-site" : r.charAt(0).toUpperCase() + r.slice(1)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </FilterSection>

            {/* Regions */}
            <FilterSection
              title="Regions"
              icon={<MapPin className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("regions")}
              onToggle={() => toggleSection("regions")}
            >
              <input
                value={local["regions"] ?? ""}
                onChange={(e) => set("regions", e.target.value)}
                onBlur={() => persist("regions")}
                placeholder="e.g. Germany, EU"
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
              />
            </FilterSection>

            {/* Languages */}
            <FilterSection
              title="Languages"
              icon={<FileText className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("languages")}
              onToggle={() => toggleSection("languages")}
            >
              <div className="space-y-1">
                {LANG_OPTS.map((l) => {
                  const current = (local["languages"] ?? "").split(",").filter(Boolean);
                  const active = current.includes(l);
                  return (
                    <div
                      key={l}
                      onClick={() => {
                        const next = active ? current.filter((x) => x !== l) : [...current, l];
                        const val = next.filter(Boolean).join(",");
                        set("languages", val);
                        save.mutate({ key: "languages", value: val });
                      }}
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                          active ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white"
                        }`}
                      >
                        {active && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span className={active ? "text-gray-900 font-medium" : "text-gray-600"}>
                        {l === "en" ? "English" : "German"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </FilterSection>

            {/* German Level */}
            <FilterSection
              title="German Level"
              collapsed={collapsedSections.has("german")}
              onToggle={() => toggleSection("german")}
            >
              <div className="space-y-1">
                {GERMAN_LEVELS.map((g) => (
                  <div
                    key={g}
                    onClick={() => {
                      set("german_level", g);
                      save.mutate({ key: "german_level", value: g });
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        (local["german_level"] ?? "B1") === g
                          ? "border-blue-600 bg-blue-600"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {(local["german_level"] ?? "B1") === g && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span className={`${(local["german_level"] ?? "B1") === g ? "text-gray-900 font-medium" : "text-gray-600"}`}>
                      {g === "none" ? "None required" : g}
                    </span>
                  </div>
                ))}
              </div>
            </FilterSection>

            {/* Exclusions */}
            <FilterSection
              title="Exclusions"
              icon={<X className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("exclusions")}
              onToggle={() => toggleSection("exclusions")}
            >
              <div className="space-y-2.5">
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">Companies</label>
                  <input
                    value={local["excluded_companies"] ?? ""}
                    onChange={(e) => set("excluded_companies", e.target.value)}
                    onBlur={() => persist("excluded_companies")}
                    placeholder="e.g. Acme Corp, Evil Inc"
                    className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">Keywords</label>
                  <input
                    value={local["excluded_keywords"] ?? ""}
                    onChange={(e) => set("excluded_keywords", e.target.value)}
                    onBlur={() => persist("excluded_keywords")}
                    placeholder="e.g. internship, junior"
                    className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </FilterSection>

            {/* AI Filtering */}
            <FilterSection
              title="AI Filtering"
              icon={<Sparkles className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("ai")}
              onToggle={() => toggleSection("ai")}
            >
              <div className="space-y-3">
                <label className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Enable AI scoring</span>
                  <button
                    onClick={() => toggle("ai_filter_enabled")}
                    className={`relative h-4.5 w-8 rounded-full transition-colors ${
                      local["ai_filter_enabled"] === "true" ? "bg-blue-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        local["ai_filter_enabled"] === "true" ? "translate-x-3.5" : ""
                      }`}
                    />
                  </button>
                </label>
                {local["ai_filter_enabled"] === "true" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-500">Threshold</span>
                      <span className="text-[10px] font-semibold text-blue-600">
                        {local["ai_filter_threshold"] ?? "40"}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={local["ai_filter_threshold"] ?? "40"}
                      onChange={(e) => {
                        set("ai_filter_threshold", e.target.value);
                        save.mutate({ key: "ai_filter_threshold", value: e.target.value });
                      }}
                      className="w-full h-1 accent-blue-600"
                    />
                    <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                      <span>Keep all</span>
                      <span>Strict</span>
                    </div>
                  </div>
                )}
              </div>
            </FilterSection>

            {/* Schedule */}
            <FilterSection
              title="Auto Schedule"
              icon={<Clock className="h-3.5 w-3.5" />}
              collapsed={collapsedSections.has("schedule")}
              onToggle={() => toggleSection("schedule")}
            >
              <div className="space-y-2.5">
                <label className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Scheduled scans</span>
                  <button
                    onClick={() => toggle("scan_enabled")}
                    className={`relative h-4.5 w-8 rounded-full transition-colors ${
                      local["scan_enabled"] === "true" ? "bg-blue-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        local["scan_enabled"] === "true" ? "translate-x-3.5" : ""
                      }`}
                    />
                  </button>
                </label>
                {local["scan_enabled"] === "true" && (() => {
                  const parsed = parseSchedule(local["scan_cron"]);
                  const showHour = parsed.freq === "Daily" || parsed.freq === "Twice daily";
                  const updateCron = (freq: string, hour: number) => {
                    const preset = SCHEDULE_FREQUENCIES.find(f => f.label === freq);
                    if (!preset) return;
                    const val = preset.cron(hour);
                    set("scan_cron", val);
                    save.mutate({ key: "scan_cron", value: val });
                  };
                  return (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {SCHEDULE_FREQUENCIES.map((f) => (
                          <button
                            key={f.label}
                            onClick={() => updateCron(f.label, parsed.hour)}
                            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                              parsed.freq === f.label
                                ? "bg-blue-600 text-white"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      {showHour && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500">at</span>
                          <select
                            value={parsed.hour}
                            onChange={(e) => updateCron(parsed.freq, parseInt(e.target.value))}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-700 focus:border-blue-400 focus:outline-none"
                          >
                            {Array.from({ length: 24 }, (_, i) => (
                              <option key={i} value={i}>
                                {i === 0 ? "12 AM" : i < 12 ? `${i} AM` : i === 12 ? "12 PM" : `${i - 12} PM`}
                              </option>
                            ))}
                          </select>
                          {parsed.freq === "Twice daily" && (
                            <span className="text-[10px] text-gray-400">
                              &amp; {((parsed.hour + 10) % 24) === 0 ? "12 AM" : ((parsed.hour + 10) % 24) < 12 ? `${(parsed.hour + 10) % 24} AM` : ((parsed.hour + 10) % 24) === 12 ? "12 PM" : `${((parsed.hour + 10) % 24) - 12} PM`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </FilterSection>
          </div>
        )}
        </div>
      </div>

      {/* ── Right: Scan Results ── */}
      <div className="flex-1 overflow-y-auto pb-6 pl-6">
        {/* Header */}
        <div className="sticky top-0 bg-gray-50 z-10 pb-4 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!filtersOpen && (
                <button
                  onClick={() => setFiltersOpen(true)}
                  className="rounded-md border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  title="Show filters"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              )}
              <div>
                <h1 className="text-xl font-bold text-gray-900">Scan</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.length > 0
                    ? `${data.length} scan${data.length > 1 ? "s" : ""} in history`
                    : "Run your first scan to discover jobs"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {data.length > 0 && !showClearConfirm && (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear All Data
                </button>
              )}
              {showClearConfirm && (
                <div className="flex items-center gap-2 animate-in fade-in">
                  <button
                    onClick={() => clearScans.mutate()}
                    disabled={clearScans.isPending}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {clearScans.isPending ? "Clearing..." : "Confirm Clear All"}
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <button
                onClick={handleScan}
                disabled={scan.isPending}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
                {scan.isPending ? "Scanning..." : "Scan Now"}
              </button>
            </div>
          </div>
        </div>

        {/* Live progress panel */}
        {(scan.isPending || (progressSteps.length > 0 && !scan.isIdle)) && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-gradient-to-b from-blue-50/80 to-white overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-blue-100 bg-blue-50/60">
              <Radio className={`h-3.5 w-3.5 text-blue-600 ${scan.isPending ? "animate-pulse" : ""}`} />
              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                {scan.isPending ? "Scan in progress" : "Scan finished"}
              </span>
              {scan.isPending && (
                <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin ml-auto" />
              )}
            </div>
            <div ref={progressRef} className="max-h-52 overflow-y-auto px-3 py-2 space-y-1">
              {progressSteps.map((step) => (
                <div key={step.id} className="flex items-start gap-2 py-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <div className="mt-0.5 shrink-0">
                    {step.status === "active" && (
                      <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                    )}
                    {step.status === "done" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                    {step.status === "error" && (
                      <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                    {step.status === "pending" && (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs leading-snug ${
                      step.status === "active" ? "text-blue-700 font-medium" :
                      step.status === "done" ? "text-gray-600" :
                      step.status === "error" ? "text-red-600" : "text-gray-400"
                    }`}>
                      {step.message}
                    </p>
                    {step.detail && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{step.detail}</p>
                    )}
                  </div>
                </div>
              ))}
              {scan.isPending && progressSteps.length === 0 && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                  <span className="text-xs text-gray-500">Starting scan...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scan result banner */}
        {scan.isSuccess && !scan.isPending && progressSteps.length === 0 && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            Scan complete: <strong>{scan.data.total_found}</strong> found, <strong>{scan.data.new_inserted}</strong> new jobs inserted.
          </div>
        )}

        {/* Loading */}
        {scans.isLoading && (
          <div className="flex items-center gap-2 py-12 justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading scan history...
          </div>
        )}

        {/* Error */}
        {scans.isError && (
          <div className="flex items-center gap-2 py-8 text-red-600">
            <AlertCircle className="h-5 w-5" />
            Failed to load scan history.
          </div>
        )}

        {/* Empty state */}
        {!scans.isLoading && data.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-sm font-medium text-gray-600 mb-1">No scans yet</p>
            <p className="text-xs text-gray-400 mb-4">
              Configure your filters on the left, then hit "Scan Now" to discover jobs.
            </p>
          </div>
        )}

        {/* Scan list */}
        {data.length > 0 && (
          <div className="space-y-3">
            {data.map((s) => (
              <ScanRow
                key={s.id}
                scan={s}
                isExpanded={expanded.has(s.id)}
                onToggle={() => toggleExpand(s.id)}
                onSelectJob={setSelectedJob}
              />
            ))}
          </div>
        )}

        {/* Job Detail Modal */}
        {selectedJob && (
          <JobDetailModal
            job={selectedJob}
            userSkills={userSkills}
            onClose={() => setSelectedJob(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ── Active Filter Chips ── */
function ActiveFilterChips({
  local,
  set,
  save,
}: {
  local: Record<string, string>;
  set: (key: string, value: string) => void;
  save: ReturnType<typeof useSaveSetting>;
}) {
  const chips: { label: string; onClear: () => void }[] = [];

  if (local["target_roles"]) {
    chips.push({
      label: `Roles: ${local["target_roles"].split(",").length}`,
      onClear: () => { set("target_roles", ""); save.mutate({ key: "target_roles", value: "" }); },
    });
  }
  if (local["posted_since"]) {
    const found = POSTED_SINCE_OPTIONS.find((o) => o.value === local["posted_since"]);
    chips.push({
      label: `Since: ${found?.label ?? local["posted_since"]}`,
      onClear: () => { set("posted_since", ""); save.mutate({ key: "posted_since", value: "" }); },
    });
  }
  if (local["preferred_remote_policy"]) {
    chips.push({
      label: `Remote: ${local["preferred_remote_policy"]}`,
      onClear: () => { set("preferred_remote_policy", ""); save.mutate({ key: "preferred_remote_policy", value: "" }); },
    });
  }
  if (local["regions"]) {
    chips.push({
      label: `Regions: ${local["regions"]}`,
      onClear: () => { set("regions", ""); save.mutate({ key: "regions", value: "" }); },
    });
  }
  if (local["excluded_companies"]) {
    chips.push({
      label: `Excl. companies`,
      onClear: () => { set("excluded_companies", ""); save.mutate({ key: "excluded_companies", value: "" }); },
    });
  }
  if (local["excluded_keywords"]) {
    chips.push({
      label: `Excl. keywords`,
      onClear: () => { set("excluded_keywords", ""); save.mutate({ key: "excluded_keywords", value: "" }); },
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pb-2">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700"
        >
          {chip.label}
          <button
            onClick={chip.onClear}
            className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100 transition-colors"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

/* ── Filter Section (collapsible) ── */
function FilterSection({
  title,
  icon,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between py-2.5 text-left group"
      >
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-gray-400">{icon}</span>}
          <span className="text-xs font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
            {title}
          </span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
            collapsed ? "-rotate-90" : ""
          }`}
        />
      </button>
      {!collapsed && <div className="pb-3">{children}</div>}
    </div>
  );
}

/* ── Scan Row ── */
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
          <AlertCircle className="h-2.5 w-2.5" />
          Failed
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
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
  onSelectJob,
}: {
  scan: ScanSession;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectJob: (job: Job) => void;
}) {
  const errors: string[] = scan.errors ? JSON.parse(scan.errors) : [];
  const pipelineStats: PipelineStats | null = scan.pipeline_stats
    ? JSON.parse(scan.pipeline_stats)
    : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">Scan #{scan.id}</span>
            <StatusBadge status={scan.status} />
            {errors.length > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                {errors.length} error{errors.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {new Date(scan.started_at).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-5 text-xs shrink-0">
          <div className="text-center">
            <p className="font-semibold text-gray-900">{scan.total_found}</p>
            <p className="text-[10px] text-gray-400">Found</p>
          </div>
          <div className="text-center">
            <p className="font-semibold text-green-600">+{scan.new_inserted}</p>
            <p className="text-[10px] text-gray-400">New</p>
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-600">
              {formatDuration(scan.started_at, scan.completed_at)}
            </p>
            <p className="text-[10px] text-gray-400">Time</p>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {/* Pipeline funnel */}
          {pipelineStats && (
            <div>
              <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Pipeline
              </h3>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700 font-medium">
                  {pipelineStats.fetched} fetched
                </span>
                <span className="text-gray-300">&rarr;</span>
                <span className="rounded bg-yellow-50 px-2 py-0.5 text-yellow-700 font-medium">
                  {pipelineStats.prefilter_passed} pre-filtered
                </span>
                <span className="text-gray-300">&rarr;</span>
                {pipelineStats.ai_evaluated > 0 && (
                  <>
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700 font-medium">
                      {pipelineStats.ai_passed} AI-passed
                    </span>
                    <span className="text-gray-300">&rarr;</span>
                  </>
                )}
                <span className="rounded bg-green-100 px-2 py-0.5 font-semibold text-green-700">
                  {pipelineStats.inserted} inserted
                </span>
              </div>
            </div>
          )}

          {/* Source breakdown */}
          {scan.source_results.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Sources
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-gray-400">
                    <th className="pb-1.5 font-medium">Source</th>
                    <th className="pb-1.5 font-medium">Found</th>
                    <th className="pb-1.5 font-medium">New</th>
                    <th className="pb-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.source_results.map((sr) => (
                    <tr key={sr.id} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium text-gray-700">{sr.source}</td>
                      <td className="py-1.5 text-gray-600">{sr.jobs_found}</td>
                      <td className="py-1.5 text-green-600">+{sr.jobs_new}</td>
                      <td className="py-1.5">
                        {sr.error ? (
                          <span className="text-red-500 text-[10px]">{sr.error}</span>
                        ) : (
                          <span className="text-green-600 text-[10px]">OK</span>
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
              <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Errors
              </h3>
              <ul className="space-y-1">
                {errors.map((err, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-red-600">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Jobs */}
          <ScanJobs scanId={scan.id} onSelectJob={onSelectJob} />
        </div>
      )}
    </div>
  );
}

/* ── Scan Jobs ── */
function ScanJobs({
  scanId,
  onSelectJob,
}: {
  scanId: number;
  onSelectJob: (job: Job) => void;
}) {
  const { data: jobs, isLoading } = useJobsForScan(scanId);
  const generate = useGenerateCoverLetter();
  const [generatingJobId, setGeneratingJobId] = useState<number | null>(null);
  const [generatedJobIds, setGeneratedJobIds] = useState<Set<number>>(new Set());

  const handleGenerate = (jobId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setGeneratingJobId(jobId);
    generate.mutate(
      { jobId, language: "en", tone: "professional" },
      {
        onSuccess: () => {
          setGeneratedJobIds((prev) => new Set(prev).add(jobId));
          setGeneratingJobId(null);
        },
        onError: () => setGeneratingJobId(null),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading jobs...
      </div>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <p className="py-2 text-[11px] text-gray-400">
        No jobs linked to this scan.
      </p>
    );
  }

  return (
    <div>
      <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Jobs ({jobs.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="pb-2 pr-3 font-medium">Score</th>
              <th className="pb-2 pr-3 font-medium">Title</th>
              <th className="pb-2 pr-3 font-medium">Company</th>
              <th className="pb-2 pr-3 font-medium">Location</th>
              <th className="pb-2 pr-3 font-medium">Remote</th>
              <th className="pb-2 pr-3 font-medium">Posted</th>
              <th className="pb-2 pr-3 font-medium">Lang</th>
              <th className="pb-2 pr-3 font-medium">Source</th>
              <th className="pb-2 pr-3 font-medium">Match Reason</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const score = job.relevance_score ?? 0;
              const isGenerating = generatingJobId === job.id;
              const isGenerated = generatedJobIds.has(job.id);
              return (
                <tr
                  key={job.id}
                  onClick={() => onSelectJob(job)}
                  className="cursor-pointer border-b border-gray-50 hover:bg-blue-50/30 transition-colors"
                >
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        score >= 70
                          ? "bg-green-100 text-green-700"
                          : score >= 40
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {score.toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2 pr-3 max-w-[200px]">
                    <span className="font-medium text-gray-900 line-clamp-1">{job.title}</span>
                  </td>
                  <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                    {job.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3 text-gray-400 shrink-0" />
                        <span className="truncate max-w-[120px]">{job.company}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                    {job.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-gray-400 shrink-0" />
                        <span className="truncate max-w-[120px]">{job.location}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <RemoteBadge policy={job.remote_policy} />
                  </td>
                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                    {job.posted_at ? formatPostedDate(job.posted_at) : (
                      <span className="text-gray-300">--</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <LangIcon lang={job.language} />
                  </td>
                  <td className="py-2 pr-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 whitespace-nowrap">
                      {job.source}
                    </span>
                  </td>
                  <td className="py-2 pr-3 max-w-[200px]">
                    {job.match_reason && (
                      <span className="text-[10px] text-blue-600 line-clamp-1">{job.match_reason}</span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openExternal(job.url);
                        }}
                        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => handleGenerate(job.id, e)}
                        disabled={isGenerating}
                        className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                          isGenerated
                            ? "bg-green-50 text-green-600"
                            : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                        } disabled:opacity-50`}
                      >
                        {isGenerating ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isGenerated ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <FileText className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Remote Policy Badge ── */
function RemoteBadge({ policy }: { policy: string | null | undefined }) {
  if (!policy) return <span className="text-gray-300">--</span>;

  switch (policy) {
    case "remote":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          <Wifi className="h-2.5 w-2.5" />
          Remote
        </span>
      );
    case "hybrid":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
          <Home className="h-2.5 w-2.5" />
          Hybrid
        </span>
      );
    case "onsite":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
          <Building className="h-2.5 w-2.5" />
          On-site
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500">
          {policy}
        </span>
      );
  }
}

/* ── Format posted date as relative time ── */
function formatPostedDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks}w ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months}mo ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* ── Language icon with flag ── */
const LANG_FLAGS: Record<string, { flag: string; label: string }> = {
  en: { flag: "\uD83C\uDDEC\uD83C\uDDE7", label: "English" },
  de: { flag: "\uD83C\uDDE9\uD83C\uDDEA", label: "German" },
  fr: { flag: "\uD83C\uDDEB\uD83C\uDDF7", label: "French" },
  es: { flag: "\uD83C\uDDEA\uD83C\uDDF8", label: "Spanish" },
  it: { flag: "\uD83C\uDDEE\uD83C\uDDF9", label: "Italian" },
  nl: { flag: "\uD83C\uDDF3\uD83C\uDDF1", label: "Dutch" },
  pt: { flag: "\uD83C\uDDF5\uD83C\uDDF9", label: "Portuguese" },
  pl: { flag: "\uD83C\uDDF5\uD83C\uDDF1", label: "Polish" },
};

function LangIcon({ lang }: { lang: string | null | undefined }) {
  if (!lang) return <span className="text-gray-300">--</span>;
  const entry = LANG_FLAGS[lang.toLowerCase()];
  if (entry) {
    return (
      <span className="cursor-default" title={entry.label}>
        {entry.flag}
      </span>
    );
  }
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 uppercase" title={lang}>
      {lang}
    </span>
  );
}
