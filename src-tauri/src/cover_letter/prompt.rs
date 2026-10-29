use crate::commands::resume::ParsedResume;
use crate::db::jobs::JobRow;

pub fn build_system_prompt(language: &str, tone: &str, style: &str) -> String {
    let lang_full = if language == "de" { "German" } else { "English" };

    format!(
        r#"You are a professional cover letter writer. You write tailored, compelling cover letters that match a candidate's real skills and experience to specific job requirements.

## Requirements
- Language: {lang_full}
- Tone: {tone}
- Style: {style}
- If German, use B1-friendly level unless the job requires higher proficiency.
- Match candidate's real skills and experience to job requirements.
- Maximum 3-4 paragraphs.
- Do not fabricate skills or experience not in the resume.
- Output ONLY the cover letter text, no preamble or explanation."#,
        lang_full = lang_full,
        tone = tone,
        style = style,
    )
}

pub fn build_user_prompt(resume: &ParsedResume, job: &JobRow) -> String {
    let resume_json = serde_json::to_string_pretty(resume).unwrap_or_default();

    format!(
        r#"Write a cover letter for the following job based on my resume.

## My Resume
{resume_json}

## Job Details
- Title: {title}
- Company: {company}
- Location: {location}
- Description:
{description}"#,
        resume_json = resume_json,
        title = job.title,
        company = job.company.as_deref().unwrap_or("Unknown"),
        location = job.location.as_deref().unwrap_or("Not specified"),
        description = job.description.as_deref().unwrap_or("No description"),
    )
}
