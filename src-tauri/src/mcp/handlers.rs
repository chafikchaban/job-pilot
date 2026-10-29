use rusqlite::Connection;

pub fn handle_method(
    method: &str,
    params: Option<&serde_json::Value>,
    db_path: &str,
) -> Result<serde_json::Value, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    match method {
        "query_jobs" => {
            let filters = params
                .and_then(|p| p.get("filters"))
                .and_then(|f| serde_json::from_value(f.clone()).ok())
                .unwrap_or_default();
            let (jobs, total) =
                crate::db::jobs::get_jobs(&conn, &filters).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "jobs": jobs, "total": total }))
        }
        "get_applications" => {
            let status = params
                .and_then(|p| p.get("status"))
                .and_then(|s| s.as_str());
            let apps = crate::db::applications::get_applications(&conn, status)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!(apps))
        }
        "get_analytics" => {
            let analytics = build_analytics(&conn)?;
            Ok(serde_json::json!(analytics))
        }
        "get_resume" => {
            let resume =
                crate::db::resume::get_resume(&conn).map_err(|e| e.to_string())?;
            Ok(serde_json::json!(resume))
        }
        _ => Err(format!("Unknown method: {}", method)),
    }
}

fn build_analytics(
    conn: &Connection,
) -> Result<serde_json::Value, String> {
    let total_jobs: i64 = conn
        .query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let total_apps: i64 = conn
        .query_row("SELECT COUNT(*) FROM applications", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "total_jobs_discovered": total_jobs,
        "total_applications": total_apps,
    }))
}
