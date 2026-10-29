import { useState, useEffect } from "react";
import {
  Key,
  Globe,
  SlidersHorizontal,
  Clock,
  FileText,
  Database,
  Save,
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  Download,
} from "lucide-react";
import { useSettings, useSaveSetting } from "../hooks/useSettings";
import { invoke } from "@tauri-apps/api/core";

const API_KEYS = [
  { key: "ADZUNA_APP_ID", label: "Adzuna App ID" },
  { key: "ADZUNA_APP_KEY", label: "Adzuna App Key" },
  { key: "RAPIDAPI_KEY", label: "RapidAPI Key (JSearch)" },
  { key: "BRAVE_SEARCH_API_KEY", label: "Brave Search API Key" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" },
];

const JOB_SOURCES = [
  { key: "source_adzuna", label: "Adzuna" },
  { key: "source_jsearch", label: "JSearch (RapidAPI)" },
  { key: "source_linkedin", label: "LinkedIn (Scraper)" },
  { key: "source_stepstone", label: "Stepstone.de (Scraper)" },
  { key: "source_brave", label: "Brave Web Search" },
];

const REMOTE_OPTS = ["remote", "hybrid", "onsite"];
const LANG_OPTS = ["en", "de"];
const GERMAN_LEVELS = ["none", "A1", "A2", "B1", "B2", "C1", "C2", "native"];
const CRON_PRESETS = [
  { label: "Every 6 hours", value: "0 0 */6 * * *" },
  { label: "Every 12 hours", value: "0 0 */12 * * *" },
  { label: "Daily at 9 AM", value: "0 0 9 * * *" },
  { label: "Twice a day", value: "0 0 9,18 * * *" },
];
const TONE_OPTIONS = ["professional", "friendly", "confident", "concise"];

export function Settings() {
  const { data: settings, isLoading } = useSettings();
  const save = useSaveSetting();
  const [local, setLocal] = useState<Record<string, string>>({});
  const [masked, setMasked] = useState<Record<string, boolean>>({});

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

  const handleClearJobs = async () => {
    if (confirm("This will delete all job listings. Continue?")) {
      await invoke("clear_jobs");
    }
  };

  const handleExport = async () => {
    await invoke("export_data");
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* API Keys */}
      <Section icon={<Key className="h-4 w-4" />} title="API Keys">
        <div className="space-y-3">
          {API_KEYS.map(({ key, label }) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={masked[key] === false ? "text" : "password"}
                    value={local[key] ?? ""}
                    onChange={(e) => set(key, e.target.value)}
                    placeholder={`Enter ${label}...`}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMasked((m) => ({ ...m, [key]: !(m[key] === false) ? false : true }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {masked[key] === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  onClick={() => persist(key)}
                  className="rounded-lg bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
                >
                  <Save className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Job Sources */}
      <Section icon={<Globe className="h-4 w-4" />} title="Job Sources">
        <div className="space-y-2">
          {JOB_SOURCES.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
              <span className="text-sm text-gray-700">{label}</span>
              <button
                onClick={() => toggle(key)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  local[key] === "true" ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    local[key] === "true" ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </Section>

      {/* Search Preferences */}
      <Section icon={<SlidersHorizontal className="h-4 w-4" />} title="Search Preferences">
        <div className="space-y-4">
          {/* Target Roles */}
          <SettingField label="Target Roles (comma-separated)">
            <input
              value={local["target_roles"] ?? ""}
              onChange={(e) => set("target_roles", e.target.value)}
              onBlur={() => persist("target_roles")}
              placeholder="Senior Frontend Engineer, React Developer"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </SettingField>

          {/* Remote Policy */}
          <SettingField label="Remote Policy">
            <div className="flex gap-2">
              {REMOTE_OPTS.map((r) => {
                const current = (local["preferred_remote_policy"] ?? "").split(",");
                const active = current.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => {
                      const next = active ? current.filter((x) => x !== r) : [...current, r];
                      const val = next.filter(Boolean).join(",");
                      set("preferred_remote_policy", val);
                      save.mutate({ key: "preferred_remote_policy", value: val });
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      active ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </SettingField>

          {/* Regions */}
          <SettingField label="Regions (comma-separated)">
            <input
              value={local["regions"] ?? ""}
              onChange={(e) => set("regions", e.target.value)}
              onBlur={() => persist("regions")}
              placeholder="Germany, EU"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </SettingField>

          {/* Languages */}
          <SettingField label="Languages">
            <div className="flex gap-3">
              {LANG_OPTS.map((l) => {
                const current = (local["languages"] ?? "").split(",");
                const active = current.includes(l);
                return (
                  <label key={l} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => {
                        const next = active ? current.filter((x) => x !== l) : [...current, l];
                        const val = next.filter(Boolean).join(",");
                        set("languages", val);
                        save.mutate({ key: "languages", value: val });
                      }}
                      className="accent-blue-600"
                    />
                    {l === "en" ? "English" : "German"}
                  </label>
                );
              })}
            </div>
          </SettingField>

          {/* German Level */}
          <SettingField label="German Level">
            <select
              value={local["german_level"] ?? "B1"}
              onChange={(e) => {
                set("german_level", e.target.value);
                save.mutate({ key: "german_level", value: e.target.value });
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {GERMAN_LEVELS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </SettingField>

          {/* Exclusions */}
          <SettingField label="Excluded Companies (comma-separated)">
            <input
              value={local["excluded_companies"] ?? ""}
              onChange={(e) => set("excluded_companies", e.target.value)}
              onBlur={() => persist("excluded_companies")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </SettingField>

          <SettingField label="Excluded Keywords (comma-separated)">
            <input
              value={local["excluded_keywords"] ?? ""}
              onChange={(e) => set("excluded_keywords", e.target.value)}
              onBlur={() => persist("excluded_keywords")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </SettingField>
        </div>
      </Section>

      {/* Scan Schedule */}
      <Section icon={<Clock className="h-4 w-4" />} title="Scan Schedule">
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Enable Scheduled Scans</span>
            <button
              onClick={() => toggle("scan_enabled")}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                local["scan_enabled"] === "true" ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  local["scan_enabled"] === "true" ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
          <div className="flex flex-wrap gap-2">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  set("scan_cron", p.value);
                  save.mutate({ key: "scan_cron", value: p.value });
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  local["scan_cron"] === p.value
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Cover Letter Defaults */}
      <Section icon={<FileText className="h-4 w-4" />} title="Cover Letter Defaults">
        <div className="space-y-3">
          <SettingField label="Default Tone">
            <select
              value={local["cl_default_tone"] ?? "professional"}
              onChange={(e) => {
                set("cl_default_tone", e.target.value);
                save.mutate({ key: "cl_default_tone", value: e.target.value });
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </SettingField>
        </div>
      </Section>

      {/* Data Management */}
      <Section icon={<Database className="h-4 w-4" />} title="Data Management">
        <div className="flex gap-3">
          <button
            onClick={handleClearJobs}
            className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> Clear All Jobs
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" /> Export Data
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700">
        {icon} {title}
      </h2>
      {children}
    </div>
  );
}

function SettingField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
