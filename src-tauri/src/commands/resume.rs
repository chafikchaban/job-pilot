use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeData {
    pub id: i64,
    pub file_name: Option<String>,
    pub parsed_json: Option<String>,
    pub target_roles: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedResume {
    pub full_text: String,
    pub skills: Vec<String>,
    pub experience: Vec<Experience>,
    pub education: Vec<Education>,
    pub languages: Vec<LanguageEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Experience {
    pub title: String,
    pub company: String,
    pub duration: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Education {
    pub degree: String,
    pub institution: String,
    pub year: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageEntry {
    pub name: String,
    pub level: String,
}

fn extract_text_from_pdf(data: &[u8]) -> Result<String, String> {
    // Use a simple approach: try to extract text from PDF
    // pdf-extract can be flaky, so we do a best-effort extraction
    let text = pdf_extract::extract_text_from_mem(data).map_err(|e| e.to_string())?;
    Ok(text)
}

fn extract_text_from_docx(data: &[u8]) -> Result<String, String> {
    use std::io::{Cursor, Read};
    let reader = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    let mut text = String::new();
    if let Ok(mut file) = archive.by_name("word/document.xml") {
        let mut xml = String::new();
        file.read_to_string(&mut xml).map_err(|e| e.to_string())?;
        // Simple XML text extraction - get content between <w:t> tags
        for part in xml.split("<w:t") {
            if let Some(content) = part.split('>').nth(1) {
                if let Some(t) = content.split("</w:t>").next() {
                    text.push_str(t);
                    text.push(' ');
                }
            }
        }
    }
    Ok(text.trim().to_string())
}

#[tauri::command]
pub fn upload_resume(
    state: State<AppState>,
    file_path: String,
) -> Result<ResumeData, String> {
    let raw_file = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let full_text = if file_name.ends_with(".pdf") {
        extract_text_from_pdf(&raw_file)?
    } else if file_name.ends_with(".docx") {
        extract_text_from_docx(&raw_file)?
    } else {
        return Err("Unsupported file type. Please upload a PDF or DOCX file.".into());
    };

    let parsed = ParsedResume {
        full_text,
        skills: Vec::new(),
        experience: Vec::new(),
        education: Vec::new(),
        languages: Vec::new(),
    };
    let parsed_json = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;

    // Get default target roles from settings
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let target_roles: String = db
        .conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'target_roles'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "[]".to_string());

    let id = crate::db::resume::insert_resume(
        &db.conn,
        &raw_file,
        &file_name,
        &parsed_json,
        &target_roles,
    )
    .map_err(|e| e.to_string())?;

    Ok(ResumeData {
        id,
        file_name: Some(file_name),
        parsed_json: Some(parsed_json),
        target_roles: Some(target_roles),
        updated_at: None,
    })
}

#[tauri::command]
pub fn get_resume(state: State<AppState>) -> Result<Option<ResumeData>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = crate::db::resume::get_resume(&db.conn).map_err(|e| e.to_string())?;
    Ok(row.map(|r| ResumeData {
        id: r.id,
        file_name: r.file_name,
        parsed_json: r.parsed_json,
        target_roles: r.target_roles,
        updated_at: r.updated_at,
    }))
}

#[tauri::command]
pub fn update_resume_parsed(
    state: State<AppState>,
    parsed_json: String,
    target_roles: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resume = crate::db::resume::get_resume(&db.conn)
        .map_err(|e| e.to_string())?
        .ok_or("No resume found")?;
    crate::db::resume::update_resume_parsed(&db.conn, resume.id, &parsed_json, &target_roles)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_resume(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let resume = crate::db::resume::get_resume(&db.conn)
        .map_err(|e| e.to_string())?
        .ok_or("No resume found")?;
    crate::db::resume::delete_resume(&db.conn, resume.id).map_err(|e| e.to_string())
}
