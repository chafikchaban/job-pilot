use crate::db::jobs::{self, JobFilters, JobRow};
use crate::sources::orchestrator::SourceOrchestrator;
use crate::sources::SearchQuery;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanSummary {
    pub total_found: u32,
    pub new_inserted: u32,
    pub errors: Vec<String>,
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

fn build_search_query(settings: &HashMap<String, String>) -> SearchQuery {
    let keywords: Vec<String> = settings
        .get("target_roles")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_else(|| vec!["software engineer".into()]);

    let regions: Vec<String> = settings
        .get("regions")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_else(|| vec!["Germany".into()]);

    SearchQuery {
        keywords,
        location: regions.first().cloned(),
        remote_policy: settings.get("preferred_remote_policy").cloned(),
        date_range_days: Some(7),
        language: settings
            .get("languages")
            .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
            .and_then(|v| v.first().cloned()),
        page: 1,
        per_page: 20,
    }
}

#[tauri::command]
pub async fn scan_jobs(
    state: State<'_, AppState>,
    _sources: Option<Vec<String>>,
) -> Result<ScanSummary, String> {
    let settings = load_settings_map(&state)?;
    let query = build_search_query(&settings);
    let orchestrator = SourceOrchestrator::new(&settings);

    let results = orchestrator.scan_all(&query).await;

    let mut total_found: u32 = 0;
    let mut new_inserted: u32 = 0;
    let mut errors: Vec<String> = Vec::new();

    let db = state.db.lock().map_err(|e| e.to_string())?;

    for (scan_result, job_listings) in &results {
        total_found += scan_result.jobs_found;

        if let Some(err) = &scan_result.error {
            errors.push(format!("{}: {}", scan_result.source, err));
        }

        let mut source_new = 0u32;
        for job in job_listings {
            match jobs::insert_job(&db.conn, job) {
                Ok(true) => {
                    source_new += 1;
                    new_inserted += 1;
                }
                Ok(false) => {} // Duplicate
                Err(e) => {
                    errors.push(format!("Insert error: {}", e));
                }
            }
        }

        jobs::insert_scan_log(
            &db.conn,
            &scan_result.source,
            scan_result.jobs_found,
            source_new,
            scan_result.error.as_deref(),
        )
        .ok();
    }

    // Score new jobs if resume exists
    drop(db);
    score_unscored_jobs(&state).ok();

    Ok(ScanSummary {
        total_found,
        new_inserted,
        errors,
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

    // Get unscored jobs (score = 0.0)
    let mut stmt = db
        .conn
        .prepare("SELECT id, title, company, location, remote_policy, description, url, apply_url, source, language, german_level_required, posted_at, fetched_at, relevance_score, dedup_hash FROM jobs WHERE relevance_score = 0.0 OR relevance_score IS NULL")
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
