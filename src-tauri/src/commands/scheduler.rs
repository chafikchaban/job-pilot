use crate::db::jobs;
use crate::scheduler::SchedulerStatus;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanLogEntry {
    pub id: i64,
    pub source: String,
    pub jobs_found: i64,
    pub jobs_new: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn start_scheduler(
    state: State<AppState>,
    cron_expression: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.conn
        .execute(
            "INSERT INTO settings (key, value) VALUES ('scan_cron_expression', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1",
            rusqlite::params![cron_expression],
        )
        .map_err(|e| e.to_string())?;
    db.conn
        .execute(
            "INSERT INTO settings (key, value) VALUES ('scan_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stop_scheduler(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.conn
        .execute(
            "INSERT INTO settings (key, value) VALUES ('scan_enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_scheduler_status(state: State<AppState>) -> Result<SchedulerStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let enabled: String = db
        .conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'scan_enabled'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "false".into());

    let cron: String = db
        .conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'scan_cron_expression'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "0 0 */6 * * *".into());

    let last_scan: Option<String> = db
        .conn
        .query_row(
            "SELECT completed_at FROM scan_log ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(SchedulerStatus {
        running: enabled == "true",
        cron_expression: cron,
        last_scan,
    })
}

#[tauri::command]
pub fn get_scan_history(
    state: State<AppState>,
    limit: Option<u32>,
) -> Result<Vec<ScanLogEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = jobs::get_scan_logs(&db.conn, limit.unwrap_or(20)).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| ScanLogEntry {
            id: r.id,
            source: r.source,
            jobs_found: r.jobs_found,
            jobs_new: r.jobs_new,
            started_at: r.started_at,
            completed_at: r.completed_at,
            error: r.error,
        })
        .collect())
}
