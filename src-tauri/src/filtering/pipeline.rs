use crate::filtering::ai_filter::{self, UserProfile};
use crate::filtering::prefilter::{self, PreFilterConfig};
use crate::sources::RawJobListing;
use std::collections::{HashMap, HashSet};

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

pub async fn run_pipeline(
    jobs: Vec<RawJobListing>,
    config: &PipelineConfig,
) -> (Vec<ScoredJob>, PipelineStats) {
    let fetched = jobs.len() as u32;
    eprintln!("[pipeline] Starting with {} jobs", fetched);

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
                let stats = PipelineStats {
                    fetched,
                    deduped: fetched,
                    prefilter_passed,
                    ai_evaluated: 0,
                    ai_passed: 0,
                    inserted: 0,
                };
                return (Vec::new(), stats);
            }
        }
    }

    // No AI scoring: pass all prefilter survivors with rule-based score
    // But still try extraction if API key is available
    eprintln!("[pipeline] AI filter disabled, using rule-based scoring");
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
