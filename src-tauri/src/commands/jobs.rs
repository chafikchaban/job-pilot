use crate::db::jobs::{self, JobFilters, JobRow};
use crate::filtering::pipeline::{self, PipelineConfig, PipelineStats};
use crate::sources::orchestrator::SourceOrchestrator;
use crate::sources::RawJobListing;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct SourceResult {
    pub source: String,
    pub found: u32,
    pub new: u32,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanSummary {
    pub total_found: u32,
    pub new_inserted: u32,
    pub errors: Vec<String>,
    pub source_results: Vec<SourceResult>,
    pub pipeline_stats: Option<PipelineStats>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JobsPage {
    pub jobs: Vec<JobRow>,
    pub total: u32,
}

fn load_settings_map(state: &State<AppState>) -> Result<HashMap<String, String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let map = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(map)
}

fn load_resume_data(state: &State<AppState>) -> (Vec<String>, String) {
    let db = match state.db.lock() {
        Ok(db) => db,
        Err(_) => return (Vec::new(), String::new()),
    };

    let resume = crate::db::resume::get_resume(&db.conn)
        .ok()
        .flatten();

    match resume {
        Some(r) => {
            let parsed: Option<crate::commands::resume::ParsedResume> = r
                .parsed_json
                .as_deref()
                .and_then(|j| serde_json::from_str(j).ok());

            match parsed {
                Some(p) => {
                    let experience_summary = p
                        .experience
                        .iter()
                        .map(|e| format!("{} at {}", e.title, e.company))
                        .collect::<Vec<_>>()
                        .join("; ");
                    (p.skills, experience_summary)
                }
                None => (Vec::new(), String::new()),
            }
        }
        None => (Vec::new(), String::new()),
    }
}

#[tauri::command]
pub async fn scan_jobs(
    state: State<'_, AppState>,
    sources: Option<Vec<String>>,
) -> Result<ScanSummary, String> {
    let _ = sources;
    let settings = load_settings_map(&state)?;

    // Create scan session
    let scan_id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        jobs::create_scan(&db.conn).map_err(|e| e.to_string())?
    };

    let orchestrator = SourceOrchestrator::new(&settings);

    // Fetch from all sources concurrently with per-source optimized queries
    let results = orchestrator.scan_all_concurrent().await;

    let mut total_found: u32 = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut source_results: Vec<SourceResult> = Vec::new();
    let mut all_jobs: Vec<RawJobListing> = Vec::new();

    for (scan_result, job_listings) in &results {
        total_found += scan_result.jobs_found;

        if let Some(err) = &scan_result.error {
            errors.push(format!("{}: {}", scan_result.source, err));
        }

        source_results.push(SourceResult {
            source: scan_result.source.clone(),
            found: scan_result.jobs_found,
            new: 0, // Will be updated after pipeline
            error: scan_result.error.clone(),
        });

        all_jobs.extend(job_listings.iter().cloned());
    }

    // Load resume data for filtering
    let (skills, experience_summary) = load_resume_data(&state);

    // Load existing dedup hashes for in-memory dedup
    let existing_hashes = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        jobs::get_all_dedup_hashes(&db.conn).map_err(|e| e.to_string())?
    };

    // Build pipeline config
    let pipeline_config =
        PipelineConfig::from_settings(&settings, skills, experience_summary, existing_hashes);

    // Run the filtering pipeline
    let (scored_jobs, mut pipeline_stats) =
        pipeline::run_pipeline(all_jobs, &pipeline_config).await;

    // Insert surviving jobs into DB
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut new_inserted: u32 = 0;

    for scored_job in &scored_jobs {
        let inserted = if scored_job.score > 0.0 {
            jobs::insert_job_with_score(
                &db.conn,
                &scored_job.job,
                scored_job.score,
                scored_job.match_reason.as_deref(),
                scored_job.parsed_info.as_deref(),
            )
        } else {
            jobs::insert_job(&db.conn, &scored_job.job)
        };

        match inserted {
            Ok(true) => {
                new_inserted += 1;
                // Update per-source counts
                if let Some(sr) = source_results
                    .iter_mut()
                    .find(|sr| sr.source == scored_job.job.source)
                {
                    sr.new += 1;
                }
            }
            Ok(false) => {} // Duplicate
            Err(e) => {
                errors.push(format!("Insert error: {}", e));
            }
        }
    }

    pipeline_stats.inserted = new_inserted;

    // Log per-source results with scan session
    for sr in &source_results {
        jobs::insert_scan_log_with_session(
            &db.conn,
            scan_id,
            &sr.source,
            sr.found,
            sr.new,
            sr.error.as_deref(),
        )
        .ok();
    }

    // Complete the scan session
    let stats_json = serde_json::to_string(&pipeline_stats).ok();
    let errors_json = if errors.is_empty() {
        None
    } else {
        serde_json::to_string(&errors).ok()
    };
    let status = if errors.is_empty() {
        "completed"
    } else {
        "completed"
    };
    jobs::complete_scan(
        &db.conn,
        scan_id,
        total_found,
        new_inserted,
        stats_json.as_deref(),
        errors_json.as_deref(),
        status,
    )
    .ok();

    // Score unscored jobs (for those inserted without AI score)
    drop(db);
    score_unscored_jobs(&state).ok();

    Ok(ScanSummary {
        total_found,
        new_inserted,
        errors,
        source_results,
        pipeline_stats: Some(pipeline_stats),
    })
}

fn score_unscored_jobs(state: &State<AppState>) -> Result<u32, String> {
    use crate::matching::scorer::{score_job, UserPreferences};

    let db = state.db.lock().map_err(|e| e.to_string())?;

    let resume = crate::db::resume::get_resume(&db.conn)
        .map_err(|e| e.to_string())?;
    let resume = match resume {
        Some(r) => r,
        None => return Ok(0),
    };

    let parsed: crate::commands::resume::ParsedResume = resume
        .parsed_json
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or(crate::commands::resume::ParsedResume {
            full_text: String::new(),
            skills: Vec::new(),
            experience: Vec::new(),
            education: Vec::new(),
            languages: Vec::new(),
        });

    let mut settings_stmt = db
        .conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let settings: HashMap<String, String> = settings_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let prefs = UserPreferences {
        target_roles: settings
            .get("target_roles")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default(),
        preferred_remote_policy: settings
            .get("preferred_remote_policy")
            .cloned()
            .unwrap_or_else(|| "remote".into()),
        accept_hybrid: settings
            .get("accept_hybrid")
            .map_or(true, |v| v == "true"),
        regions: settings
            .get("regions")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default(),
        german_level: settings
            .get("german_level")
            .cloned()
            .unwrap_or_else(|| "B1".into()),
    };

    // Only score jobs not yet scored by AI
    let mut stmt = db
        .conn
        .prepare("SELECT id, title, company, location, remote_policy, description, url, apply_url, source, language, german_level_required, posted_at, fetched_at, relevance_score, dedup_hash, match_reason, ai_scored, parsed_info FROM jobs WHERE (ai_scored = 0 OR ai_scored IS NULL) AND (relevance_score = 0.0 OR relevance_score IS NULL)")
        .map_err(|e| e.to_string())?;
    let unscored: Vec<JobRow> = stmt
        .query_map([], |row| {
            Ok(JobRow {
                id: row.get(0)?,
                title: row.get(1)?,
                company: row.get(2)?,
                location: row.get(3)?,
                remote_policy: row.get(4)?,
                description: row.get(5)?,
                url: row.get(6)?,
                apply_url: row.get(7)?,
                source: row.get(8)?,
                language: row.get(9)?,
                german_level_required: row.get(10)?,
                posted_at: row.get(11)?,
                fetched_at: row.get(12)?,
                relevance_score: row.get(13)?,
                dedup_hash: row.get(14)?,
                match_reason: row.get(15)?,
                ai_scored: row.get(16)?,
                parsed_info: row.get(17)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut count = 0u32;
    for job in &unscored {
        let result = score_job(job, &parsed, &prefs);
        jobs::update_job_relevance(&db.conn, job.id, result.total_score).ok();
        count += 1;
    }

    Ok(count)
}

#[tauri::command]
pub fn get_jobs(state: State<AppState>, filters: JobFilters) -> Result<JobsPage, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (job_rows, total) = jobs::get_jobs(&db.conn, &filters).map_err(|e| e.to_string())?;
    Ok(JobsPage {
        jobs: job_rows,
        total,
    })
}

#[tauri::command]
pub fn get_job(state: State<AppState>, id: i64) -> Result<JobRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    jobs::get_job_by_id(&db.conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Job not found".into())
}
