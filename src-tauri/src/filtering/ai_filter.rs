use crate::sources::RawJobListing;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const BATCH_SIZE: usize = 10;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedJobInfo {
    pub core_skills: Vec<String>,
    pub nice_to_have_skills: Vec<String>,
    pub benefits: Vec<String>,
    pub responsibilities: Vec<String>,
    pub interview_process: Vec<String>,
    pub salary_range: Option<String>,
    pub seniority_level: Option<String>,
    pub experience_years: Option<String>,
    pub contract_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiJobScore {
    pub index: usize,
    pub score: u32,
    pub reason: String,
    pub parsed_info: Option<ParsedJobInfo>,
}

#[derive(Debug, Clone)]
pub struct AiFilterResult {
    /// (job, score, reason, parsed_info JSON)
    pub scored_jobs: Vec<(RawJobListing, u32, String, Option<String>)>,
    pub total_evaluated: usize,
    pub passed_count: usize,
}

pub struct UserProfile {
    pub target_roles: Vec<String>,
    pub skills: Vec<String>,
    pub experience_summary: String,
    pub preferred_remote_policy: String,
    pub regions: Vec<String>,
    pub german_level: String,
}

impl UserProfile {
    pub fn from_settings(
        settings: &std::collections::HashMap<String, String>,
        skills: Vec<String>,
        experience_summary: String,
    ) -> Self {
        let target_roles: Vec<String> = settings
            .get("target_roles")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default();
        let regions: Vec<String> = settings
            .get("regions")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default();

        Self {
            target_roles,
            skills,
            experience_summary,
            preferred_remote_policy: settings
                .get("preferred_remote_policy")
                .cloned()
                .unwrap_or_else(|| "remote".into()),
            regions,
            german_level: settings
                .get("german_level")
                .cloned()
                .unwrap_or_else(|| "B1".into()),
        }
    }
}

pub async fn evaluate_jobs(
    api_key: &str,
    jobs: Vec<RawJobListing>,
    profile: &UserProfile,
    threshold: u32,
) -> Result<AiFilterResult, Box<dyn std::error::Error + Send + Sync>> {
    if jobs.is_empty() {
        return Ok(AiFilterResult {
            scored_jobs: Vec::new(),
            total_evaluated: 0,
            passed_count: 0,
        });
    }

    let total = jobs.len();
    let total_batches = (total + BATCH_SIZE - 1) / BATCH_SIZE;
    let mut all_scored: Vec<(RawJobListing, u32, String, Option<String>)> = Vec::new();

    // Process in batches
    for chunk_start in (0..jobs.len()).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(jobs.len());
        let batch = &jobs[chunk_start..chunk_end];
        let batch_num = chunk_start / BATCH_SIZE + 1;

        eprintln!(
            "[ai_filter] Scoring batch {}/{} ({} jobs)...",
            batch_num, total_batches, batch.len()
        );

        match evaluate_batch(api_key, batch, profile).await {
            Ok(scores) => {
                eprintln!(
                    "[ai_filter] Batch {}/{} done — {} scores returned",
                    batch_num, total_batches, scores.len()
                );
                for score_entry in scores {
                    let job_idx = chunk_start + score_entry.index;
                    if job_idx < jobs.len() {
                        let parsed_json = score_entry
                            .parsed_info
                            .as_ref()
                            .and_then(|pi| serde_json::to_string(pi).ok());
                        all_scored.push((
                            jobs[job_idx].clone(),
                            score_entry.score,
                            score_entry.reason,
                            parsed_json,
                        ));
                    }
                }
            }
            Err(e) => {
                eprintln!("[ai_filter] Batch {}/{} FAILED: {}", batch_num, total_batches, e);
                // On error, pass all jobs in this batch with a default score
                for (i, _) in batch.iter().enumerate() {
                    let job_idx = chunk_start + i;
                    all_scored.push((
                        jobs[job_idx].clone(),
                        50, // Default mid-range score on API failure
                        "AI evaluation failed, using default score".into(),
                        None,
                    ));
                }
            }
        }
    }

    let passed_count = all_scored.iter().filter(|(_, s, _, _)| *s >= threshold).count();

    // Only keep jobs above threshold
    let scored_jobs: Vec<(RawJobListing, u32, String, Option<String>)> = all_scored
        .into_iter()
        .filter(|(_, score, _, _)| *score >= threshold)
        .collect();

    Ok(AiFilterResult {
        scored_jobs,
        total_evaluated: total,
        passed_count,
    })
}

/// Extract structured info only (no scoring) — for use when AI filter is disabled
/// but API key is available. Returns parsed_info JSON or None.
pub async fn extract_structured_info(
    api_key: &str,
    jobs: &[RawJobListing],
) -> Vec<Option<String>> {
    if api_key.is_empty() || jobs.is_empty() {
        return jobs.iter().map(|_| None).collect();
    }

    let mut results: Vec<Option<String>> = vec![None; jobs.len()];
    let total_batches = (jobs.len() + BATCH_SIZE - 1) / BATCH_SIZE;

    for chunk_start in (0..jobs.len()).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(jobs.len());
        let batch = &jobs[chunk_start..chunk_end];
        let batch_num = chunk_start / BATCH_SIZE + 1;

        eprintln!(
            "[ai_filter] Extracting batch {}/{} ({} jobs)...",
            batch_num, total_batches, batch.len()
        );

        match extract_batch(api_key, batch).await {
            Ok(infos) => {
                for (i, info) in infos.into_iter().enumerate() {
                    let idx = chunk_start + i;
                    if idx < results.len() {
                        results[idx] = info
                            .as_ref()
                            .and_then(|pi| serde_json::to_string(pi).ok());
                    }
                }
            }
            Err(e) => {
                eprintln!("[ai_filter] Extraction batch error: {}", e);
            }
        }
    }

    results
}

async fn extract_batch(
    api_key: &str,
    batch: &[RawJobListing],
) -> Result<Vec<Option<ParsedJobInfo>>, Box<dyn std::error::Error + Send + Sync>> {
    let prompt = build_extraction_prompt(batch);

    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 4096,
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        }))
        .send()
        .await?;

    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        return Err(format!("Claude API error ({}): {}", status, body).into());
    }

    let response: serde_json::Value = serde_json::from_str(&body)?;
    let text = response["content"][0]["text"]
        .as_str()
        .unwrap_or("[]");

    let json_str = extract_json_array(text);

    #[derive(Deserialize)]
    struct ExtractEntry {
        index: usize,
        parsed_info: Option<ParsedJobInfo>,
    }

    let entries: Vec<ExtractEntry> = serde_json::from_str(&json_str).unwrap_or_default();
    let mut results: Vec<Option<ParsedJobInfo>> = vec![None; batch.len()];
    for entry in entries {
        if entry.index < results.len() {
            results[entry.index] = entry.parsed_info;
        }
    }

    Ok(results)
}

async fn evaluate_batch(
    api_key: &str,
    batch: &[RawJobListing],
    profile: &UserProfile,
) -> Result<Vec<AiJobScore>, Box<dyn std::error::Error + Send + Sync>> {
    let prompt = build_batch_prompt(batch, profile);

    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 4096,
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        }))
        .send()
        .await?;

    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        return Err(format!("Claude API error ({}): {}", status, body).into());
    }

    let response: serde_json::Value = serde_json::from_str(&body)?;
    let text = response["content"][0]["text"]
        .as_str()
        .unwrap_or("[]");

    // Extract JSON array from response (handle markdown code blocks)
    let json_str = extract_json_array(text);
    let scores: Vec<AiJobScore> = serde_json::from_str(&json_str)
        .unwrap_or_default();

    Ok(scores)
}

fn extract_json_array(text: &str) -> String {
    // Try to find JSON array in the text (may be wrapped in ```json ... ```)
    if let Some(start) = text.find('[') {
        if let Some(end) = text.rfind(']') {
            return text[start..=end].to_string();
        }
    }
    "[]".to_string()
}

fn build_batch_prompt(batch: &[RawJobListing], profile: &UserProfile) -> String {
    let mut jobs_text = String::new();
    for (i, job) in batch.iter().enumerate() {
        let desc_preview = job
            .description
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(2000)
            .collect::<String>();
        jobs_text.push_str(&format!(
            "\n---\nJob #{}: {}\nCompany: {}\nLocation: {}\nDescription: {}\n",
            i,
            job.title,
            job.company.as_deref().unwrap_or("Unknown"),
            job.location.as_deref().unwrap_or("Not specified"),
            desc_preview,
        ));
    }

    format!(
        r#"You are a job matching evaluator. Score each job's relevance to this candidate AND extract structured information from the job description.

## Candidate Profile
- Target roles: {}
- Key skills: {}
- Experience: {}
- Preferred work: {} in {}
- German level: {}

## Jobs to Evaluate
{}

## Instructions
For each job:
1. Assign a relevance score from 0-100:
   - 80-100: Excellent match (role, skills, and preferences align strongly)
   - 60-79: Good match (most criteria align, minor gaps)
   - 40-59: Partial match (some relevant aspects but significant gaps)
   - 20-39: Weak match (tangentially related)
   - 0-19: Not relevant at all

2. Extract structured information from the description (if available):
   - core_skills: Required/must-have technical skills
   - nice_to_have_skills: Optional/preferred skills
   - benefits: Company perks, benefits, culture highlights
   - responsibilities: Key job duties
   - interview_process: Interview steps if mentioned
   - salary_range: Salary info if mentioned (null otherwise)
   - seniority_level: Junior/Mid/Senior/Lead/Staff/Principal (null if unclear)
   - experience_years: e.g. "3-5 years" (null if not mentioned)
   - contract_type: Full-time/Part-time/Contract/Freelance (null if not mentioned)

Return ONLY a JSON array, no other text:
[{{"index": 0, "score": 85, "reason": "Strong React/TS match, remote in Germany", "parsed_info": {{"core_skills": ["React", "TypeScript"], "nice_to_have_skills": ["GraphQL"], "benefits": ["Remote work", "30 days PTO"], "responsibilities": ["Build frontend features"], "interview_process": [], "salary_range": null, "seniority_level": "Senior", "experience_years": "5+ years", "contract_type": "Full-time"}}}}, ...]

If a job has no description, set parsed_info to null."#,
        profile.target_roles.join(", "),
        profile.skills.join(", "),
        profile.experience_summary,
        profile.preferred_remote_policy,
        profile.regions.join(", "),
        profile.german_level,
        jobs_text,
    )
}

fn build_extraction_prompt(batch: &[RawJobListing]) -> String {
    let mut jobs_text = String::new();
    for (i, job) in batch.iter().enumerate() {
        let desc = job
            .description
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(2000)
            .collect::<String>();
        if desc.is_empty() {
            continue;
        }
        jobs_text.push_str(&format!(
            "\n---\nJob #{}: {}\nCompany: {}\nDescription: {}\n",
            i,
            job.title,
            job.company.as_deref().unwrap_or("Unknown"),
            desc,
        ));
    }

    format!(
        r#"Extract structured information from these job descriptions.

{}

For each job, extract:
- core_skills: Required/must-have technical skills
- nice_to_have_skills: Optional/preferred skills
- benefits: Company perks, benefits, culture highlights
- responsibilities: Key job duties
- interview_process: Interview steps if mentioned
- salary_range: Salary info if mentioned (null otherwise)
- seniority_level: Junior/Mid/Senior/Lead/Staff/Principal (null if unclear)
- experience_years: e.g. "3-5 years" (null if not mentioned)
- contract_type: Full-time/Part-time/Contract/Freelance (null if not mentioned)

Return ONLY a JSON array:
[{{"index": 0, "parsed_info": {{"core_skills": [...], "nice_to_have_skills": [...], "benefits": [...], "responsibilities": [...], "interview_process": [], "salary_range": null, "seniority_level": "Senior", "experience_years": "5+ years", "contract_type": "Full-time"}}}}, ...]"#,
        jobs_text,
    )
}
