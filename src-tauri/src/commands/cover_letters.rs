use crate::db::{cover_letters, jobs, resume};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverLetterData {
    pub id: i64,
    pub job_id: i64,
    pub content: String,
    pub language: String,
    pub tone: String,
    pub generated_at: String,
    pub edited_at: Option<String>,
}

impl From<cover_letters::CoverLetterRow> for CoverLetterData {
    fn from(row: cover_letters::CoverLetterRow) -> Self {
        Self {
            id: row.id,
            job_id: row.job_id,
            content: row.content,
            language: row.language,
            tone: row.tone,
            generated_at: row.generated_at,
            edited_at: row.edited_at,
        }
    }
}

#[tauri::command]
pub async fn generate_cover_letter(
    state: State<'_, AppState>,
    job_id: i64,
    language: String,
    tone: String,
) -> Result<CoverLetterData, String> {
    // Get API key
    let (api_key, resume_data, job, style) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        let api_key: String = db
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'anthropic_api_key'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if api_key.is_empty() {
            return Err("Anthropic API key not configured. Set it in Settings.".into());
        }

        let resume_row = resume::get_resume(&db.conn)
            .map_err(|e| e.to_string())?
            .ok_or("No resume uploaded. Please upload your resume first.")?;

        let job = jobs::get_job_by_id(&db.conn, job_id)
            .map_err(|e| e.to_string())?
            .ok_or("Job not found")?;

        let style: String = db
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'cover_letter_style'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "concise".into());

        (api_key, resume_row, job, style)
    };

    let parsed: crate::commands::resume::ParsedResume = resume_data
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

    let prompt =
        crate::cover_letter::prompt::build_prompt(&parsed, &job, &language, &tone, &style);

    let content = crate::cover_letter::generator::generate(&api_key, &prompt)
        .await
        .map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = cover_letters::insert_cover_letter(&db.conn, job_id, &content, &language, &tone)
        .map_err(|e| e.to_string())?;

    let row = cover_letters::get_cover_letter(&db.conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("Failed to retrieve generated cover letter")?;

    Ok(row.into())
}

#[tauri::command]
pub fn get_cover_letters(
    state: State<AppState>,
    job_id: Option<i64>,
) -> Result<Vec<CoverLetterData>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = cover_letters::get_cover_letters(&db.conn, job_id).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| r.into()).collect())
}

#[tauri::command]
pub fn get_cover_letter(state: State<AppState>, id: i64) -> Result<CoverLetterData, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    cover_letters::get_cover_letter(&db.conn, id)
        .map_err(|e| e.to_string())?
        .map(|r| r.into())
        .ok_or_else(|| "Cover letter not found".into())
}

#[tauri::command]
pub fn update_cover_letter(
    state: State<AppState>,
    id: i64,
    content: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    cover_letters::update_cover_letter_content(&db.conn, id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_cover_letter(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    cover_letters::delete_cover_letter(&db.conn, id).map_err(|e| e.to_string())
}
