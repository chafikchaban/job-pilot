use crate::db::applications;
use crate::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn create_application(state: State<AppState>, job_id: i64) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    applications::create_application(&db.conn, job_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_applications(
    state: State<AppState>,
    status_filter: Option<String>,
) -> Result<Vec<applications::ApplicationWithJob>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    applications::get_applications(&db.conn, status_filter.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_application(
    state: State<AppState>,
    id: i64,
    status: Option<String>,
    notes: Option<String>,
    follow_up_date: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(s) = status {
        applications::update_application_status(&db.conn, id, &s).map_err(|e| e.to_string())?;
    }
    if let Some(n) = notes {
        applications::update_application_notes(&db.conn, id, &n).map_err(|e| e.to_string())?;
    }
    if let Some(d) = follow_up_date {
        let date = if d.is_empty() { None } else { Some(d.as_str()) };
        applications::set_follow_up_date(&db.conn, id, date).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_application(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    applications::delete_application(&db.conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_application_stats(state: State<AppState>) -> Result<HashMap<String, u32>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    applications::get_application_stats(&db.conn).map_err(|e| e.to_string())
}
