use crate::db::jobs;
use crate::sources::brave_search::BraveSearchSource;
use crate::sources::{JobSource, SearchQuery};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct WebSearchSummary {
    pub total_found: u32,
    pub new_inserted: u32,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn run_web_search(
    state: State<'_, AppState>,
    custom_query: Option<String>,
) -> Result<WebSearchSummary, String> {
    let (api_key, query) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        let api_key: String = db
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'brave_search_api_key'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if api_key.is_empty() {
            return Err("Brave Search API key not configured. Set it in Settings.".into());
        }

        let keywords = if let Some(q) = custom_query {
            vec![q]
        } else {
            let target_roles: Vec<String> = db
                .conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'target_roles'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or_else(|| vec!["software engineer".into()]);
            target_roles
        };

        let query = SearchQuery {
            keywords,
            location: Some("Germany".into()),
            per_page: 10,
            ..Default::default()
        };

        (api_key, query)
    };

    let source = BraveSearchSource::new(api_key);
    let results = source
        .fetch_jobs(&query)
        .await
        .map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut new_count = 0u32;
    let total = results.len() as u32;
    let mut errors = Vec::new();

    for job in &results {
        match jobs::insert_job(&db.conn, job, None) {
            Ok(true) => new_count += 1,
            Ok(false) => {}
            Err(e) => errors.push(e.to_string()),
        }
    }

    jobs::insert_scan_log(&db.conn, "brave_search", total, new_count, None).ok();

    Ok(WebSearchSummary {
        total_found: total,
        new_inserted: new_count,
        errors,
    })
}
