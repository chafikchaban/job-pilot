import {
  X,
  ExternalLink,
  MapPin,
  Building2,
  Calendar,
  CheckCircle2,
  XCircle,
  Briefcase,
  GraduationCap,
  Award,
  ClipboardList,
} from "lucide-react";
import type { Job, ParsedJobInfo } from "../lib/types";
import {
  extractSections,
  formatPostedDate,
  matchSkillsWithResume,
} from "../lib/job-parser";
import { openExternal } from "../lib/tauri";

interface Props {
  job: Job;
  userSkills: string[];
  onClose: () => void;
}

function parseParsedInfo(job: Job): ParsedJobInfo | null {
  if (!job.parsed_info) return null;
  try {
    return JSON.parse(job.parsed_info) as ParsedJobInfo;
  } catch {
    return null;
  }
}

export function JobDetailModal({ job, userSkills, onClose }: Props) {
  const aiInfo = parseParsedInfo(job);
  const fallback = extractSections(job.description ?? "", job.title);

  // Use AI-extracted data if available, otherwise fall back to regex parser
  const coreSkills = aiInfo?.core_skills ?? fallback.coreSkills;
  const niceToHaveSkills = aiInfo?.nice_to_have_skills ?? fallback.niceToHaveSkills;
  const responsibilities = aiInfo?.responsibilities ?? fallback.responsibilities;
  const benefits = aiInfo?.benefits ?? fallback.benefits;
  const interviewProcess = aiInfo?.interview_process ?? fallback.interviewProcess;

  const coreMatched = matchSkillsWithResume(coreSkills, userSkills);
  const niceMatched = matchSkillsWithResume(niceToHaveSkills, userSkills);
  const posted = formatPostedDate(job.posted_at);
  const score = job.relevance_score ?? 0;

  const allMatched = [...coreMatched, ...niceMatched];
  const matchedCount = allMatched.filter((s) => s.hasSkill).length;
  const totalSkills = allMatched.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="border-b border-gray-100 p-6 pb-5">
          <h2 className="pr-8 text-xl font-bold text-gray-900">{job.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
            {job.company && (
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" />
                {job.company}
              </span>
            )}
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {job.location}
              </span>
            )}
            {posted.relative && (
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {posted.full}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {job.remote_policy && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {job.remote_policy}
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {job.source}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                score >= 70
                  ? "bg-green-100 text-green-700"
                  : score >= 40
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {score.toFixed(0)}% match
            </span>
            {job.match_reason && (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
                {job.match_reason}
              </span>
            )}
            {aiInfo?.seniority_level && (
              <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                {aiInfo.seniority_level}
              </span>
            )}
            {aiInfo?.experience_years && (
              <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                {aiInfo.experience_years}
              </span>
            )}
            {aiInfo?.contract_type && (
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
                {aiInfo.contract_type}
              </span>
            )}
            {aiInfo?.salary_range && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {aiInfo.salary_range}
              </span>
            )}
          </div>
        </div>

        <div className="max-h-[calc(100vh-200px)] space-y-6 overflow-y-auto p-6">
          {/* Profile Match Breakdown */}
          {totalSkills > 0 && (
            <MatchBreakdown
              coreMatched={coreMatched}
              niceMatched={niceMatched}
              matchedCount={matchedCount}
              totalSkills={totalSkills}
            />
          )}

          {/* Core Skills */}
          {coreMatched.length > 0 && (
            <Section icon={<Award className="h-4 w-4" />} title="Core Skills Required">
              <div className="flex flex-wrap gap-2">
                {coreMatched.map(({ skill, hasSkill }) => (
                  <SkillPill key={skill} skill={skill} hasSkill={hasSkill} />
                ))}
              </div>
            </Section>
          )}

          {/* Nice to Have */}
          {niceMatched.length > 0 && (
            <Section icon={<GraduationCap className="h-4 w-4" />} title="Nice to Have">
              <div className="flex flex-wrap gap-2">
                {niceMatched.map(({ skill, hasSkill }) => (
                  <SkillPill key={skill} skill={skill} hasSkill={hasSkill} />
                ))}
              </div>
            </Section>
          )}

          {/* Responsibilities */}
          {responsibilities.length > 0 && (
            <Section icon={<Briefcase className="h-4 w-4" />} title="Responsibilities">
              <ul className="space-y-1.5">
                {responsibilities.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Benefits */}
          {benefits.length > 0 && (
            <Section icon={<Award className="h-4 w-4" />} title="Company Benefits">
              <ul className="space-y-1.5">
                {benefits.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Interview Process */}
          {interviewProcess.length > 0 && (
            <Section icon={<ClipboardList className="h-4 w-4" />} title="Interview Process">
              <ol className="space-y-2">
                {interviewProcess.map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {job.description && (
            <Section icon={<Briefcase className="h-4 w-4" />} title="Full Description">
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
                {job.description}
              </p>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={() => openExternal(job.apply_url ?? job.url)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            View Listing <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillPill({ skill, hasSkill }: { skill: string; hasSkill: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
        hasSkill
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-gray-200 bg-gray-50 text-gray-500"
      }`}
    >
      {hasSkill ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-gray-400" />
      )}
      {skill}
    </span>
  );
}

function MatchBreakdown({
  coreMatched,
  niceMatched,
  matchedCount,
  totalSkills,
}: {
  coreMatched: { skill: string; hasSkill: boolean }[];
  niceMatched: { skill: string; hasSkill: boolean }[];
  matchedCount: number;
  totalSkills: number;
}) {
  const coreHave = coreMatched.filter((s) => s.hasSkill).length;
  const coreTotal = coreMatched.length;
  const corePct = coreTotal > 0 ? Math.round((coreHave / coreTotal) * 100) : 0;

  const niceHave = niceMatched.filter((s) => s.hasSkill).length;
  const niceTotal = niceMatched.length;
  const nicePct = niceTotal > 0 ? Math.round((niceHave / niceTotal) * 100) : 0;

  return (
    <div className="rounded-xl bg-gradient-to-br from-slate-50 to-blue-50 p-5">
      <p className="text-center text-xs font-semibold uppercase tracking-wider text-blue-500">
        Profile match score breakdown
      </p>
      <p className="mt-1 text-center text-sm font-medium text-gray-700">
        You match {matchedCount} of {totalSkills} skills identified
      </p>
      <div className="mt-4 grid grid-cols-2 gap-6">
        <BreakdownColumn label="Core Skills" score={coreHave} total={coreTotal} pct={corePct} items={coreMatched} />
        <BreakdownColumn label="Nice to Have" score={niceHave} total={niceTotal} pct={nicePct} items={niceMatched} />
      </div>
    </div>
  );
}

function BreakdownColumn({
  label,
  score,
  total,
  pct,
  items,
}: {
  label: string;
  score: number;
  total: number;
  pct: number;
  items: { skill: string; hasSkill: boolean }[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold text-blue-700">{label}</span>
        <span className="font-semibold text-gray-700">
          {score}/{total}
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(({ skill, hasSkill }) => (
          <span
            key={skill}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
              hasSkill
                ? "border border-blue-200 bg-white text-blue-700"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {hasSkill ? (
              <CheckCircle2 className="h-3 w-3 text-blue-500" />
            ) : (
              <XCircle className="h-3 w-3 text-gray-300" />
            )}
            {skill}
          </span>
        ))}
      </div>
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
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}
