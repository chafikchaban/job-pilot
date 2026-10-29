use crate::filtering::ai_filter::{self, ParsedJobInfo, UserProfile};
use crate::filtering::prefilter::{self, PreFilterConfig};
use crate::sources::RawJobListing;
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PipelineStats {
    pub fetched: u32,
    pub deduped: u32,
    pub prefilter_passed: u32,
    pub ai_evaluated: u32,
    pub ai_passed: u32,
    pub inserted: u32,
}

#[derive(Debug, Clone)]
pub struct ScoredJob {
    pub job: RawJobListing,
    pub score: f64,
    pub match_reason: Option<String>,
    pub parsed_info: Option<String>,
}

pub struct PipelineConfig {
    pub ai_enabled: bool,
    pub ai_api_key: String,
    pub ai_threshold: u32,
    pub prefilter: PreFilterConfig,
    pub profile: UserProfile,
}

impl PipelineConfig {
    pub fn from_settings(
        settings: &HashMap<String, String>,
        skills: Vec<String>,
        experience_summary: String,
        existing_hashes: HashSet<String>,
    ) -> Self {
        let ai_enabled = settings
            .get("ai_filter_enabled")
            .map_or(true, |v| v == "true");
        let ai_api_key = settings
            .get("anthropic_api_key")
            .cloned()
            .unwrap_or_default();
        let ai_threshold: u32 = settings
            .get("ai_filter_threshold")
            .and_then(|v| v.parse().ok())
            .unwrap_or(40);

        let prefilter = PreFilterConfig::from_settings(settings, skills.clone(), existing_hashes);
        let profile = UserProfile::from_settings(settings, skills, experience_summary);

        Self {
            ai_enabled,
            ai_api_key,
            ai_threshold,
            prefilter,
            profile,
        }
    }
}

/// Infer remote_policy from description when the scraper/source didn't set it.
fn enrich_remote_policy(jobs: Vec<RawJobListing>) -> Vec<RawJobListing> {
    jobs.into_iter()
        .map(|mut job| {
            if job.remote_policy.is_none() {
                if let Some(ref desc) = job.description {
                    let d = desc.to_lowercase();
                    let title_loc = format!(
                        "{} {}",
                        job.title.to_lowercase(),
                        job.location.as_deref().unwrap_or("")
                    );
                    let combined = format!("{} {}", title_loc, d);

                    if combined.contains("100% remote")
                        || combined.contains("fully remote")
                        || combined.contains("remote-first")
                        || combined.contains("remote first")
                    {
                        job.remote_policy = Some("remote".into());
                    } else if combined.contains("hybrid")
                        || combined.contains("teilweise remote")
                        || combined.contains("teilweise homeoffice")
                    {
                        job.remote_policy = Some("hybrid".into());
                    } else if d.contains("remote möglich")
                        || d.contains("remote possible")
                        || d.contains("remote option")
                        || d.contains("homeoffice möglich")
                        || d.contains("home office möglich")
                        || d.contains("flexibles arbeiten")
                        || d.contains("mobiles arbeiten")
                        || d.contains("flexible arbeitsmodelle")
                    {
                        job.remote_policy = Some("hybrid".into());
                    } else if d.contains("vor ort")
                        || d.contains("on-site only")
                        || d.contains("office-based")
                        || d.contains("präsenzpflicht")
                    {
                        job.remote_policy = Some("onsite".into());
                    }
                }
            }
            job
        })
        .collect()
}

/// Backfill remote_policy on the RawJobListing from AI-extracted parsed_info.
fn enrich_remote_from_parsed_info(scored_jobs: Vec<ScoredJob>) -> Vec<ScoredJob> {
    scored_jobs
        .into_iter()
        .map(|mut sj| {
            if sj.job.remote_policy.is_none() {
                if let Some(ref pi_json) = sj.parsed_info {
                    if let Ok(pi) = serde_json::from_str::<ParsedJobInfo>(pi_json) {
                        if let Some(ref rp) = pi.remote_policy {
                            let normalized = rp.to_lowercase();
                            if ["remote", "hybrid", "onsite"].contains(&normalized.as_str()) {
                                sj.job.remote_policy = Some(normalized);
                            }
                        }
                    }
                }
            }
            sj
        })
        .collect()
}

pub async fn run_pipeline(
    jobs: Vec<RawJobListing>,
    config: &PipelineConfig,
) -> (Vec<ScoredJob>, PipelineStats) {
    let fetched = jobs.len() as u32;
    eprintln!("[pipeline] Starting with {} jobs", fetched);

    // Enrich remote_policy from description where missing
    let jobs = enrich_remote_policy(jobs);

    // Tier 1: Pre-filter
    let prefilter_result = prefilter::run_prefilter(jobs, &config.prefilter);
    let prefilter_passed = prefilter_result.passed.len() as u32;
    eprintln!(
        "[pipeline] Pre-filter: {} passed, {} rejected",
        prefilter_passed, prefilter_result.rejected_count
    );

    // Tier 2: AI filter (if enabled and API key is set)
    let survivors = prefilter_result.passed;

    if config.ai_enabled && !config.ai_api_key.is_empty() {
        let survivors_fallback = survivors.clone();
        match ai_filter::evaluate_jobs(
            &config.ai_api_key,
            survivors,
            &config.profile,
            config.ai_threshold,
        )
        .await
        {
            Ok(ai_result) => {
                let ai_passed = ai_result.passed_count as u32;
                eprintln!(
                    "[pipeline] AI filter: {} evaluated, {} passed (threshold: {})",
                    ai_result.total_evaluated, ai_passed, config.ai_threshold
                );

                let scored_jobs: Vec<ScoredJob> = ai_result
                    .scored_jobs
                    .into_iter()
                    .map(|(job, score, reason, parsed_info)| ScoredJob {
                        job,
                        score: score as f64,
                        match_reason: Some(reason),
                        parsed_info,
                    })
                    .collect();
                let scored_jobs = enrich_remote_from_parsed_info(scored_jobs);

                let stats = PipelineStats {
                    fetched,
                    deduped: fetched,
                    prefilter_passed,
                    ai_evaluated: ai_result.total_evaluated as u32,
                    ai_passed,
                    inserted: 0,
                };

                return (scored_jobs, stats);
            }
            Err(e) => {
                eprintln!("[pipeline] AI filter failed, falling back to rule-based: {}", e);
                return build_fallback_result(survivors_fallback, fetched, prefilter_passed, "")
                    .await;
            }
        }
    }

    // No AI scoring: pass all prefilter survivors with rule-based score
    // But still try extraction if API key is available
    eprintln!("[pipeline] AI filter disabled, using rule-based scoring");
    build_fallback_result(survivors, fetched, prefilter_passed, &config.ai_api_key).await
}

pub async fn run_pipeline_with_progress(
    jobs: Vec<RawJobListing>,
    config: &PipelineConfig,
    app: &AppHandle,
) -> (Vec<ScoredJob>, PipelineStats) {
    let fetched = jobs.len() as u32;
    eprintln!("[pipeline] Starting with {} jobs", fetched);

    // Enrich remote_policy from description where missing
    let jobs = enrich_remote_policy(jobs);

    // Tier 1: Pre-filter
    let _ = app.emit("scan-progress", serde_json::json!({
        "stage": "prefilter",
        "message": format!("Pre-filtering {} jobs...", fetched),
        "count": fetched,
    }));

    let prefilter_result = prefilter::run_prefilter(jobs, &config.prefilter);
    let prefilter_passed = prefilter_result.passed.len() as u32;
    let rejected = prefilter_result.rejected_count as u32;
    eprintln!(
        "[pipeline] Pre-filter: {} passed, {} rejected",
        prefilter_passed, rejected
    );

    let _ = app.emit("scan-progress", serde_json::json!({
        "stage": "prefilter_done",
        "message": format!("{} passed pre-filter, {} rejected", prefilter_passed, rejected),
        "count": prefilter_passed,
        "total": fetched,
    }));

    // Tier 2: AI filter (if enabled and API key is set)
    let survivors = prefilter_result.passed;

    if config.ai_enabled && !config.ai_api_key.is_empty() {
        let _ = app.emit("scan-progress", serde_json::json!({
            "stage": "ai_filter",
            "message": format!("AI evaluating {} jobs...", prefilter_passed),
            "count": prefilter_passed,
        }));

        let survivors_fallback = survivors.clone();
        match ai_filter::evaluate_jobs(
            &config.ai_api_key,
            survivors,
            &config.profile,
            config.ai_threshold,
        )
        .await
        {
            Ok(ai_result) => {
                let ai_passed = ai_result.passed_count as u32;
                eprintln!(
                    "[pipeline] AI filter: {} evaluated, {} passed (threshold: {})",
                    ai_result.total_evaluated, ai_passed, config.ai_threshold
                );

                let _ = app.emit("scan-progress", serde_json::json!({
                    "stage": "ai_filter_done",
                    "message": format!("{} jobs passed AI filter (threshold: {})", ai_passed, config.ai_threshold),
                    "count": ai_passed,
                    "total": ai_result.total_evaluated,
                }));

                let scored_jobs: Vec<ScoredJob> = ai_result
                    .scored_jobs
                    .into_iter()
                    .map(|(job, score, reason, parsed_info)| ScoredJob {
                        job,
                        score: score as f64,
                        match_reason: Some(reason),
                        parsed_info,
                    })
                    .collect();
                let scored_jobs = enrich_remote_from_parsed_info(scored_jobs);

                let stats = PipelineStats {
                    fetched,
                    deduped: fetched,
                    prefilter_passed,
                    ai_evaluated: ai_result.total_evaluated as u32,
                    ai_passed,
                    inserted: 0,
                };

                return (scored_jobs, stats);
            }
            Err(e) => {
                eprintln!("[pipeline] AI filter failed, falling back to rule-based: {}", e);
                let _ = app.emit("scan-progress", serde_json::json!({
                    "stage": "ai_filter_fallback",
                    "message": "AI filter failed, using rule-based scoring",
                    "detail": e.to_string(),
                }));
                return build_fallback_result(survivors_fallback, fetched, prefilter_passed, "")
                    .await;
            }
        }
    }

    // No AI scoring
    eprintln!("[pipeline] AI filter disabled, using rule-based scoring");
    let _ = app.emit("scan-progress", serde_json::json!({
        "stage": "ai_skip",
        "message": "AI filter disabled, using rule-based scoring",
        "count": prefilter_passed,
    }));
    build_fallback_result(survivors, fetched, prefilter_passed, &config.ai_api_key).await
}

async fn build_fallback_result(
    jobs: Vec<RawJobListing>,
    fetched: u32,
    prefilter_passed: u32,
    api_key: &str,
) -> (Vec<ScoredJob>, PipelineStats) {
    // Try extraction-only if API key is available
    let parsed_infos = ai_filter::extract_structured_info(api_key, &jobs).await;

    let count = jobs.len() as u32;
    let scored_jobs: Vec<ScoredJob> = jobs
        .into_iter()
        .enumerate()
        .map(|(i, job)| ScoredJob {
            job,
            score: 0.0, // Will be scored by rule-based scorer after insert
            match_reason: Some("Passed pre-filter (AI disabled)".into()),
            parsed_info: parsed_infos.get(i).cloned().flatten(),
        })
        .collect();
    let scored_jobs = enrich_remote_from_parsed_info(scored_jobs);

    let stats = PipelineStats {
        fetched,
        deduped: fetched,
        prefilter_passed,
        ai_evaluated: 0,
        ai_passed: count,
        inserted: 0,
    };

    (scored_jobs, stats)
}
