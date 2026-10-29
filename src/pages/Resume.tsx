import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Upload,
  X,
  Plus,
  Save,
  Loader2,
  GraduationCap,
  Briefcase,
  Languages,
  Target,
  Wrench,
} from "lucide-react";
import { useResume, useUploadResume, useUpdateResumeParsed, useReparseResume } from "../hooks/useResume";

interface ParsedResume {
  skills: string[];
  experience: { title: string; company: string; duration: string; description?: string }[];
  education: { degree: string; institution: string; year: string }[];
  languages: { name: string; level: string }[];
}

export function Resume() {
  const { data: resume, isLoading } = useResume();
  const upload = useUploadResume();
  const reparse = useReparseResume();
  const updateParsed = useUpdateResumeParsed();

  const [parsed, setParsed] = useState<ParsedResume>({
    skills: [],
    experience: [],
    education: [],
    languages: [],
  });
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [newRole, setNewRole] = useState("");

  useEffect(() => {
    if (resume?.parsed_json) {
      try { setParsed(JSON.parse(resume.parsed_json)); } catch { /* skip */ }
    }
    if (resume?.target_roles) {
      try { setTargetRoles(JSON.parse(resume.target_roles)); } catch { /* skip */ }
    }
  }, [resume]);

  const handleUpload = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Resume", extensions: ["pdf", "docx", "txt"] }],
    });
    if (selected) {
      upload.mutate(selected as string);
    }
  };

  const handleSave = () => {
    updateParsed.mutate({
      parsedJson: JSON.stringify(parsed),
      targetRoles: JSON.stringify(targetRoles),
    });
  };

  const addSkill = () => {
    const s = newSkill.trim();
    if (s && !parsed.skills.includes(s)) {
      setParsed((p) => ({ ...p, skills: [...p.skills, s] }));
      setNewSkill("");
    }
  };

  const removeSkill = (s: string) =>
    setParsed((p) => ({ ...p, skills: p.skills.filter((x) => x !== s) }));

  const addRole = () => {
    const r = newRole.trim();
    if (r && !targetRoles.includes(r)) {
      setTargetRoles((prev) => [...prev, r]);
      setNewRole("");
    }
  };

  const removeRole = (r: string) =>
    setTargetRoles((prev) => prev.filter((x) => x !== r));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading resume...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Resume</h1>
        <button
          onClick={handleSave}
          disabled={updateParsed.isPending}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {updateParsed.isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {/* Upload Zone */}
      <button
        onClick={handleUpload}
        disabled={upload.isPending}
        className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-gray-500 transition hover:border-blue-400 hover:text-blue-600"
      >
        {upload.isPending ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <Upload className="h-6 w-6" />
        )}
        <span className="text-sm font-medium">
          {resume?.file_name
            ? `Current: ${resume.file_name} (click to replace)`
            : "Click to upload resume (PDF, DOCX, TXT)"}
        </span>
      </button>

      {resume?.file_name && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reparse.mutate()}
            disabled={reparse.isPending}
            className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {reparse.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Parsing with AI...</>
            ) : (
              <><Wrench className="h-4 w-4" /> Re-parse Resume with AI</>
            )}
          </button>
          {reparse.isError && <p className="text-sm text-red-500">{String(reparse.error)}</p>}
          {reparse.isSuccess && <p className="text-sm text-green-600">Parsed successfully!</p>}
        </div>
      )}
      {!resume?.parsed_json && !upload.isPending && (
        <p className="text-center text-sm text-gray-400">
          Upload a resume to get started.
        </p>
      )}

      {/* Parsed Data */}
      {parsed && (
        <div className="grid grid-cols-2 gap-6">
          {/* Skills */}
          <Section icon={<Wrench className="h-4 w-4" />} title="Skills">
            <div className="flex flex-wrap gap-2">
              {parsed.skills.map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                >
                  {s}
                  <button onClick={() => removeSkill(s)}>
                    <X className="h-3 w-3 text-blue-400 hover:text-red-500" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSkill()}
                placeholder="Add skill..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button onClick={addSkill} className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </Section>

          {/* Target Roles */}
          <Section icon={<Target className="h-4 w-4" />} title="Target Roles">
            <div className="flex flex-wrap gap-2">
              {targetRoles.map((r) => (
                <span
                  key={r}
                  className="flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700"
                >
                  {r}
                  <button onClick={() => removeRole(r)}>
                    <X className="h-3 w-3 text-purple-400 hover:text-red-500" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRole()}
                placeholder="Add target role..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button onClick={addRole} className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </Section>

          {/* Experience */}
          <Section icon={<Briefcase className="h-4 w-4" />} title="Experience">
            {parsed.experience.length === 0 && (
              <p className="text-xs text-gray-400">No experience entries yet.</p>
            )}
            {parsed.experience.map((exp, i) => (
              <div key={i} className="border-b border-gray-100 pb-2 last:border-0">
                <p className="text-sm font-medium text-gray-800">{exp.title}</p>
                <p className="text-xs text-gray-500">{exp.company} -- {exp.duration}</p>
              </div>
            ))}
          </Section>

          {/* Education */}
          <Section icon={<GraduationCap className="h-4 w-4" />} title="Education">
            {parsed.education.length === 0 && (
              <p className="text-xs text-gray-400">No education entries yet.</p>
            )}
            {parsed.education.map((ed, i) => (
              <div key={i} className="border-b border-gray-100 pb-2 last:border-0">
                <p className="text-sm font-medium text-gray-800">{ed.degree}</p>
                <p className="text-xs text-gray-500">{ed.institution} -- {ed.year}</p>
              </div>
            ))}
          </Section>

          {/* Languages */}
          <Section icon={<Languages className="h-4 w-4" />} title="Languages">
            {parsed.languages.length === 0 && (
              <p className="text-xs text-gray-400">No languages listed.</p>
            )}
            {parsed.languages.map((lang, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-800">{lang.name}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {lang.level}
                </span>
              </div>
            ))}
          </Section>
        </div>
      )}

      {updateParsed.isSuccess && (
        <p className="text-sm text-green-600">Changes saved successfully.</p>
      )}
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
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        {icon} {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
