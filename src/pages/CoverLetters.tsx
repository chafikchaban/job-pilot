import { useState } from "react";
import {
  Plus,
  Loader2,
  FileText,
  Save,
  Trash2,
  X,
  Languages,
  Clock,
} from "lucide-react";
import {
  useCoverLetters,
  useGenerateCoverLetter,
  useUpdateCoverLetter,
  useDeleteCoverLetter,
} from "../hooks/useCoverLetters";
import { useJobs } from "../hooks/useJobs";
import type { CoverLetterData, Job } from "../lib/types";

const TONE_OPTIONS = ["professional", "friendly", "confident", "concise"];
const LANG_OPTIONS = ["en", "de"];

export function CoverLetters() {
  const { data: letters = [], isLoading } = useCoverLetters(null);
  const deleteLetter = useDeleteCoverLetter();
  const [editing, setEditing] = useState<CoverLetterData | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading cover letters...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Cover Letters</h1>
        <button
          onClick={() => setShowGenerate(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Generate
        </button>
      </div>

      {letters.length === 0 && (
        <p className="py-12 text-center text-gray-400">
          No cover letters yet. Click Generate to create one.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        {letters.map((cl) => (
          <div
            key={cl.id}
            onClick={() => setEditing(cl)}
            className="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 transition hover:shadow-md"
          >
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-gray-800">
                  Job #{cl.job_id}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteLetter.mutate(cl.id);
                }}
                className="text-gray-300 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 line-clamp-3 text-xs text-gray-500">
              {cl.content}
            </p>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Languages className="h-3 w-3" />
                {cl.language.toUpperCase()}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5">
                {cl.tone}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(cl.generated_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Editor Modal */}
      {editing && (
        <EditorModal letter={editing} onClose={() => setEditing(null)} />
      )}

      {/* Generate Dialog */}
      {showGenerate && (
        <GenerateDialog onClose={() => setShowGenerate(false)} />
      )}
    </div>
  );
}

function EditorModal({
  letter,
  onClose,
}: {
  letter: CoverLetterData;
  onClose: () => void;
}) {
  const [content, setContent] = useState(letter.content);
  const updateLetter = useUpdateCoverLetter();

  const handleSave = () => {
    updateLetter.mutate({ id: letter.id, content }, { onSuccess: onClose });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="flex w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl" style={{ maxHeight: "80vh" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Edit Cover Letter</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 resize-none rounded-lg border border-gray-300 p-3 text-sm leading-relaxed focus:border-blue-500 focus:outline-none"
          style={{ minHeight: "300px" }}
        />
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateLetter.isPending}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateLetter.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GenerateDialog({ onClose }: { onClose: () => void }) {
  const { data: jobs = [] } = useJobs({});
  const generate = useGenerateCoverLetter();
  const [jobId, setJobId] = useState<number | null>(null);
  const [language, setLanguage] = useState("en");
  const [tone, setTone] = useState("professional");

  const handleGenerate = () => {
    if (!jobId) return;
    generate.mutate({ jobId, language, tone }, { onSuccess: onClose });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Generate Cover Letter</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Job Selector */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Job</label>
            <select
              value={jobId ?? ""}
              onChange={(e) => setJobId(Number(e.target.value) || null)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select a job...</option>
              {jobs.map((j: Job) => (
                <option key={j.id} value={j.id}>
                  {j.title} {j.company ? `at ${j.company}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Language</label>
            <div className="flex gap-3">
              {LANG_OPTIONS.map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="language"
                    value={l}
                    checked={language === l}
                    onChange={() => setLanguage(l)}
                    className="accent-blue-600"
                  />
                  {l === "en" ? "English" : "German"}
                </label>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!jobId || generate.isPending}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {generate.isPending ? "Generating..." : "Generate"}
          </button>
        </div>

        {generate.isError && (
          <p className="mt-3 text-sm text-red-500">
            Error: {generate.error}
          </p>
        )}
      </div>
    </div>
  );
}
