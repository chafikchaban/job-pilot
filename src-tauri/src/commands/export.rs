use crate::db::{applications, jobs};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyticsData {
    pub total_jobs_discovered: i64,
    pub total_applications: i64,
    pub applications_by_status: HashMap<String, u32>,
    pub jobs_by_source: HashMap<String, u32>,
    pub applications_by_week: Vec<WeekCount>,
    pub response_rate: f64,
    pub avg_relevance_score: f64,
    pub scans_last_30_days: i64,
    pub jobs_last_30_days: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WeekCount {
    pub week: String,
    pub count: i64,
}

#[tauri::command]
pub fn export_applications_csv(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let apps =
        applications::get_applications(&db.conn, None).map_err(|e| e.to_string())?;

    let mut csv = String::from("id,job_title,company,status,applied_at,notes,follow_up_date\n");
    for app in &apps {
        csv.push_str(&format!(
            "{},\"{}\",\"{}\",{},{},{},{}\n",
            app.id,
            app.job_title.replace('"', "\"\""),
            app.job_company
                .as_deref()
                .unwrap_or("")
                .replace('"', "\"\""),
            app.status,
            app.applied_at.as_deref().unwrap_or(""),
            app.notes
                .as_deref()
                .unwrap_or("")
                .replace('"', "\"\""),
            app.follow_up_date.as_deref().unwrap_or(""),
        ));
    }
    Ok(csv)
}

#[tauri::command]
pub fn export_applications_json(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let apps =
        applications::get_applications(&db.conn, None).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&apps).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_jobs_csv(
    state: State<AppState>,
    filters: jobs::JobFilters,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (job_rows, _) = jobs::get_jobs(&db.conn, &filters).map_err(|e| e.to_string())?;

    let mut csv = String::from("id,title,company,location,remote_policy,source,relevance_score,posted_at,url\n");
    for job in &job_rows {
        csv.push_str(&format!(
            "{},\"{}\",\"{}\",\"{}\",{},{},{:.2},{},{}\n",
            job.id,
            job.title.replace('"', "\"\""),
            job.company.as_deref().unwrap_or("").replace('"', "\"\""),
            job.location.as_deref().unwrap_or("").replace('"', "\"\""),
            job.remote_policy.as_deref().unwrap_or(""),
            job.source,
            job.relevance_score.unwrap_or(0.0),
            job.posted_at.as_deref().unwrap_or(""),
            job.url,
        ));
    }
    Ok(csv)
}

#[tauri::command]
pub fn get_analytics(state: State<AppState>) -> Result<AnalyticsData, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let total_jobs: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let total_apps: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM applications", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let apps_by_status =
        applications::get_application_stats(&db.conn).map_err(|e| e.to_string())?;

    // Jobs by source
    let mut source_stmt = db
        .conn
        .prepare("SELECT source, COUNT(*) FROM jobs GROUP BY source")
        .map_err(|e| e.to_string())?;
    let jobs_by_source: HashMap<String, u32> = source_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Applications by week
    let mut week_stmt = db.conn.prepare(
        "SELECT strftime('%Y-W%W', applied_at) as week, COUNT(*) FROM applications WHERE applied_at IS NOT NULL GROUP BY week ORDER BY week DESC LIMIT 12"
    ).map_err(|e| e.to_string())?;
    let apps_by_week: Vec<WeekCount> = week_stmt
        .query_map([], |row| {
            Ok(WeekCount {
                week: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Response rate
    let interview_count = *apps_by_status.get("interview").unwrap_or(&0) as f64;
    let offer_count = *apps_by_status.get("offer").unwrap_or(&0) as f64;
    let applied_count = *apps_by_status.get("applied").unwrap_or(&0) as f64;
    let response_rate = if applied_count > 0.0 {
        (interview_count + offer_count) / applied_count * 100.0
    } else {
        0.0
    };

    // Average relevance score
    let avg_relevance: f64 = db
        .conn
        .query_row(
            "SELECT COALESCE(AVG(relevance_score), 0.0) FROM jobs WHERE relevance_score > 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Scans last 30 days
    let scans_30d: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM scan_log WHERE started_at > datetime('now', '-30 days')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Jobs last 30 days
    let jobs_30d: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM jobs WHERE fetched_at > datetime('now', '-30 days')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(AnalyticsData {
        total_jobs_discovered: total_jobs,
        total_applications: total_apps,
        applications_by_status: apps_by_status,
        jobs_by_source,
        applications_by_week: apps_by_week,
        response_rate,
        avg_relevance_score: avg_relevance,
        scans_last_30_days: scans_30d,
        jobs_last_30_days: jobs_30d,
    })
}

#[tauri::command]
pub fn delete_all_jobs(state: State<AppState>) -> Result<u64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    jobs::delete_all_jobs(&db.conn).map_err(|e| e.to_string())
}
