use crate::db::{jobs, resume};
use crate::matching::scorer::{score_job, UserPreferences};
use crate::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn score_all_jobs(state: State<AppState>) -> Result<u32, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let resume_row = resume::get_resume(&db.conn)
        .map_err(|e| e.to_string())?
        .ok_or("No resume found. Upload a resume first.")?;

    let parsed: crate::commands::resume::ParsedResume = resume_row
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

    let mut stmt = db
        .conn
        .prepare("SELECT id, title, company, location, remote_policy, description, url, apply_url, source, language, german_level_required, posted_at, fetched_at, relevance_score, dedup_hash, match_reason, ai_scored, parsed_info, scan_id FROM jobs WHERE relevance_score = 0.0 OR relevance_score IS NULL")
        .map_err(|e| e.to_string())?;

    let unscored: Vec<jobs::JobRow> = stmt
        .query_map([], |row| {
            Ok(jobs::JobRow {
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
                scan_id: row.get(18)?,
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
pub fn rescore_all_jobs(state: State<AppState>) -> Result<u32, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Reset all scores to 0 first
    db.conn
        .execute("UPDATE jobs SET relevance_score = 0.0", [])
        .map_err(|e| e.to_string())?;
    drop(db);

    score_all_jobs(state)
}
