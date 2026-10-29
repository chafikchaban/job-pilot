import { useState, useEffect } from "react";
import {
  Key,
  Globe,
  FileText,
  Save,
  Loader2,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Bot,
  Search,
  Zap,
  Lock,
  Monitor,
  GripVertical,
} from "lucide-react";
import { useSettings, useSaveSetting } from "../hooks/useSettings";
import { invoke } from "@tauri-apps/api/core";

/* ─── Source category definitions ─── */

interface ScraperSource {
  key: string;
  label: string;
  urlBase: string;
  loginUrl: string;
  maxPagesKey: string;
  maxPagesDefault: string;
  maxPagesRange: [number, number];
  jobsPerPage: number;
  /** Unique site identifier for the generic login system */
  siteId: string;
}

const DEFAULT_SCRAPERS: ScraperSource[] = [
  {
    key: "source_linkedin_enabled",
    label: "LinkedIn",
    urlBase: "linkedin.com",
    loginUrl: "https://www.linkedin.com/login",
    siteId: "linkedin",
    maxPagesKey: "linkedin_max_pages",
    maxPagesDefault: "3",
    maxPagesRange: [1, 10],
    jobsPerPage: 25,
  },
  {
    key: "source_stepstone_enabled",
    label: "Stepstone.de",
    urlBase: "stepstone.de",
    loginUrl: "https://www.stepstone.de/login",
    siteId: "stepstone",
    maxPagesKey: "stepstone_max_pages",
    maxPagesDefault: "3",
    maxPagesRange: [1, 10],
    jobsPerPage: 25,
  },
];

interface ApiSource {
  key: string;
  label: string;
  description: string;
}

const PUBLIC_API_SOURCES: ApiSource[] = [
  { key: "source_themuse_enabled", label: "The Muse", description: "Free, no API key needed" },
  { key: "source_remotive_enabled", label: "Remotive", description: "Remote jobs, no key needed" },
  { key: "source_arbeitnow_enabled", label: "Arbeitnow", description: "EU/German jobs, no key needed" },
];

const PRIVATE_API_SOURCES: ApiSource[] = [
  { key: "source_adzuna_enabled", label: "Adzuna", description: "Requires App ID + Key" },
  { key: "source_jsearch_enabled", label: "JSearch", description: "Via RapidAPI key" },
  { key: "source_brave_search_enabled", label: "Brave Search", description: "Requires Brave API key" },
];

const API_KEYS = [
  { key: "adzuna_app_id", label: "Adzuna App ID", group: "adzuna" },
  { key: "adzuna_app_key", label: "Adzuna App Key", group: "adzuna" },
  { key: "rapidapi_key", label: "RapidAPI Key (JSearch)", group: "jsearch" },
  { key: "brave_search_api_key", label: "Brave Search API Key", group: "brave" },
  { key: "anthropic_api_key", label: "Anthropic API Key", group: "ai" },
];

const TONE_OPTIONS = ["professional", "friendly", "confident", "concise"];

/* ─── Custom scraper boards stored as JSON in settings ─── */
interface CustomBoard {
  id: string;
  name: string;
  url: string;
  loginUrl: string;
  maxPages: string;
}

function parseCustomBoards(raw: string | undefined): CustomBoard[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/* ─── Main component ─── */

export function Settings() {
  const { data: settings, isLoading } = useSettings();
  const save = useSaveSetting();
  const [local, setLocal] = useState<Record<string, string>>({});
  const [masked, setMasked] = useState<Record<string, boolean>>({});
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [customBoards, setCustomBoards] = useState<CustomBoard[]>([]);

  useEffect(() => {
    if (settings) {
      setLocal(settings);
      setCustomBoards(parseCustomBoards(settings["custom_scraper_boards"]));
      // Auto-expand API keys if none are configured
      const hasAnyKey = API_KEYS.some(({ key }) => settings[key] && settings[key].length > 0);
      if (!hasAnyKey) setApiKeysOpen(true);
    }
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

  const persistCustomBoards = (boards: CustomBoard[]) => {
    setCustomBoards(boards);
    const json = JSON.stringify(boards);
    set("custom_scraper_boards", json);
    save.mutate({ key: "custom_scraper_boards", value: json });
  };

  const addCustomBoard = () => {
    const board: CustomBoard = {
      id: crypto.randomUUID(),
      name: "",
      url: "",
      loginUrl: "",
      maxPages: "2",
    };
    persistCustomBoards([...customBoards, board]);
  };

  const updateCustomBoard = (id: string, field: keyof CustomBoard, value: string) => {
    const updated = customBoards.map((b) => (b.id === id ? { ...b, [field]: value } : b));
    persistCustomBoards(updated);
  };

  const removeCustomBoard = (id: string) => {
    persistCustomBoards(customBoards.filter((b) => b.id !== id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading settings...
      </div>
    );
  }

  const configuredKeyCount = API_KEYS.filter(({ key }) => local[key] && local[key].length > 0).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* ═══ API Keys (collapsible) ═══ */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <button
          onClick={() => setApiKeysOpen(!apiKeysOpen)}
          className="flex w-full items-center justify-between p-5 text-left hover:bg-gray-50/50 transition-colors rounded-xl"
        >
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-700">API Keys</h2>
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {configuredKeyCount}/{API_KEYS.length} configured
            </span>
          </div>
          {apiKeysOpen ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {apiKeysOpen && (
          <div className="border-t border-gray-100 p-5 pt-4 space-y-3">
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
                      onClick={() =>
                        setMasked((m) => ({ ...m, [key]: !(m[key] === false) ? false : true }))
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {masked[key] === false ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <button
                    onClick={() => persist(key)}
                    className="rounded-lg bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200 transition-colors"
                  >
                    <Save className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Job Sources ═══ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <Globe className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Job Sources</h2>
        </div>

        {/* ── Web Scrapers ── */}
        <Section
          icon={<Monitor className="h-4 w-4" />}
          title="Web Scrapers"
          badge={`${DEFAULT_SCRAPERS.filter((s) => local[s.key] === "true").length + customBoards.length} active`}
          subtitle="Scrape job listings directly from websites using a headless browser"
        >
          <div className="space-y-3">
            {DEFAULT_SCRAPERS.map((scraper) => (
              <ScraperCard
                key={scraper.key}
                scraper={scraper}
                local={local}
                set={set}
                save={save}
                toggle={toggle}
              />
            ))}

            {/* Custom boards */}
            {customBoards.map((board) => (
              <CustomBoardCard
                key={board.id}
                board={board}
                onUpdate={updateCustomBoard}
                onRemove={removeCustomBoard}
              />
            ))}

            <button
              onClick={addCustomBoard}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2.5 text-xs font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Job Board
            </button>
          </div>
        </Section>

        {/* ── Public APIs ── */}
        <Section
          icon={<Zap className="h-4 w-4" />}
          title="Public APIs"
          badge={`${PUBLIC_API_SOURCES.filter((s) => local[s.key] === "true").length} active`}
          subtitle="Free APIs that don't require authentication"
        >
          <div className="space-y-2">
            {PUBLIC_API_SOURCES.map(({ key, label, description }) => (
              <SourceToggleRow
                key={key}
                settingKey={key}
                label={label}
                description={description}
                local={local}
                toggle={toggle}
              />
            ))}
          </div>
        </Section>

        {/* ── Private APIs ── */}
        <Section
          icon={<Lock className="h-4 w-4" />}
          title="Private APIs"
          badge={`${PRIVATE_API_SOURCES.filter((s) => local[s.key] === "true").length} active`}
          subtitle="Require API keys configured above"
        >
          <div className="space-y-2">
            {PRIVATE_API_SOURCES.map(({ key, label, description }) => (
              <SourceToggleRow
                key={key}
                settingKey={key}
                label={label}
                description={description}
                local={local}
                toggle={toggle}
              />
            ))}
          </div>
        </Section>

        {/* ── AI Search ── */}
        <Section
          icon={<Bot className="h-4 w-4" />}
          title="AI Filtering"
          subtitle="Use Claude to score and filter discovered jobs by relevance"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-700">Enable AI scoring</span>
                <p className="text-xs text-gray-400">Jobs below the threshold are hidden</p>
              </div>
              <Toggle
                enabled={local["ai_filter_enabled"] === "true"}
                onToggle={() => toggle("ai_filter_enabled")}
              />
            </div>
            {local["ai_filter_enabled"] === "true" && (
              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 whitespace-nowrap">
                  Min Score:
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={local["ai_filter_threshold"] ?? "40"}
                  onChange={(e) => {
                    set("ai_filter_threshold", e.target.value);
                    save.mutate({ key: "ai_filter_threshold", value: e.target.value });
                  }}
                  className="flex-1 accent-blue-600"
                />
                <span className="w-8 text-right text-sm font-medium text-gray-700">
                  {local["ai_filter_threshold"] ?? "40"}
                </span>
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* ═══ Cover Letter Defaults ═══ */}
      <Section
        icon={<FileText className="h-4 w-4" />}
        title="Cover Letter Defaults"
        standalone
      >
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
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </SettingField>
        </div>
      </Section>
    </div>
  );
}

/* ─── Shared login controls hook ─── */

function useScraperLogin(siteId: string, loginUrl: string) {
  const [loginStatus, setLoginStatus] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    invoke<{ logged_in: boolean }>("scraper_login_status", { site: siteId })
      .then((r) => setLoginStatus(r.logged_in))
      .catch(() => {});
  }, [siteId]);

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      await invoke("scraper_login", { site: siteId, loginUrl });
      setLoginStatus(true);
    } catch (e) {
      alert(`Login failed: ${e}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await invoke("scraper_logout", { site: siteId });
    setLoginStatus(false);
  };

  return { loginStatus, loginLoading, handleLogin, handleLogout };
}

/* ─── Login controls UI ─── */

function LoginControls({
  siteId,
  loginUrl,
}: {
  siteId: string;
  loginUrl: string;
}) {
  const { loginStatus, loginLoading, handleLogin, handleLogout } = useScraperLogin(siteId, loginUrl);

  if (!loginUrl) return null;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Session:</span>
        {loginStatus ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3 w-3" /> Logged in
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <XCircle className="h-3 w-3" /> Not logged in
          </span>
        )}
      </div>
      {loginStatus ? (
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <LogOut className="h-3 w-3" /> Logout
        </button>
      ) : (
        <button
          onClick={handleLogin}
          disabled={loginLoading}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loginLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <LogIn className="h-3 w-3" />
          )}
          {loginLoading ? "Waiting..." : "Login"}
        </button>
      )}
    </div>
  );
}

/* ─── Scraper card with login + max pages ─── */

function ScraperCard({
  scraper,
  local,
  set,
  save,
  toggle,
}: {
  scraper: ScraperSource;
  local: Record<string, string>;
  set: (k: string, v: string) => void;
  save: ReturnType<typeof useSaveSetting>;
  toggle: (k: string) => void;
}) {
  const enabled = local[scraper.key] === "true";

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        enabled ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Search className="h-4 w-4 text-gray-400" />
          <div>
            <span className="text-sm font-medium text-gray-700">{scraper.label}</span>
            <span className="ml-2 text-xs text-gray-400">{scraper.urlBase}</span>
          </div>
        </div>
        <Toggle enabled={enabled} onToggle={() => toggle(scraper.key)} />
      </div>

      {enabled && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <LoginControls siteId={scraper.siteId} loginUrl={scraper.loginUrl} />

          {/* Max pages */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500">Pages to scrape:</label>
            <input
              type="number"
              min={scraper.maxPagesRange[0]}
              max={scraper.maxPagesRange[1]}
              value={local[scraper.maxPagesKey] ?? scraper.maxPagesDefault}
              onChange={(e) => {
                set(scraper.maxPagesKey, e.target.value);
                save.mutate({ key: scraper.maxPagesKey, value: e.target.value });
              }}
              className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            />
            <span className="text-xs text-gray-400">
              (~{(parseInt(local[scraper.maxPagesKey] ?? scraper.maxPagesDefault) || 1) * scraper.jobsPerPage} jobs)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Custom board card with login ─── */

function CustomBoardCard({
  board,
  onUpdate,
  onRemove,
}: {
  board: CustomBoard;
  onUpdate: (id: string, field: keyof CustomBoard, value: string) => void;
  onRemove: (id: string) => void;
}) {
  // Derive siteId from board name or id
  const siteId = `custom_${board.id.slice(0, 8)}`;

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-gray-300" />
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Custom Board
          </span>
        </div>
        <button
          onClick={() => onRemove(board.id)}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Board Name</label>
          <input
            type="text"
            value={board.name}
            onChange={(e) => onUpdate(board.id, "name", e.target.value)}
            placeholder="e.g. Indeed DE"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Base URL</label>
          <input
            type="text"
            value={board.url}
            onChange={(e) => onUpdate(board.id, "url", e.target.value)}
            placeholder="https://indeed.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">Login URL (optional)</label>
        <input
          type="text"
          value={board.loginUrl}
          onChange={(e) => onUpdate(board.id, "loginUrl", e.target.value)}
          placeholder="https://indeed.com/login"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {board.loginUrl && (
        <LoginControls siteId={siteId} loginUrl={board.loginUrl} />
      )}

      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500">Pages to scrape:</label>
        <input
          type="number"
          min={1}
          max={10}
          value={board.maxPages}
          onChange={(e) => onUpdate(board.id, "maxPages", e.target.value)}
          className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  );
}

/* ─── Toggle switch ─── */

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        enabled ? "bg-blue-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

/* ─── Source toggle row ─── */

function SourceToggleRow({
  settingKey,
  label,
  description,
  local,
  toggle,
}: {
  settingKey: string;
  label: string;
  description: string;
  local: Record<string, string>;
  toggle: (k: string) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
      <div>
        <span className="text-sm text-gray-700">{label}</span>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
      <Toggle enabled={local[settingKey] === "true"} onToggle={() => toggle(settingKey)} />
    </div>
  );
}

/* ─── Section wrapper ─── */

function Section({
  icon,
  title,
  badge,
  subtitle,
  standalone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  subtitle?: string;
  standalone?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 ${standalone ? "" : ""}`}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{icon}</span>
          <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
          {badge && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1 pl-6 text-xs text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* ─── Setting field ─── */

function SettingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
