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
    #[serde(alias = "period")]
    pub duration: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Education {
    pub degree: String,
    #[serde(alias = "school")]
    pub institution: String,
    pub year: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageEntry {
    pub name: String,
    pub level: String,
}

fn extract_text_from_pdf(data: &[u8]) -> Result<String, String> {
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

/// Use Claude API to extract structured resume data from raw text
async fn parse_resume_with_ai(api_key: &str, full_text: &str) -> Result<ParsedResume, String> {
    let truncated: String = full_text.chars().take(8000).collect();

    let prompt = format!(
        r#"Parse this resume text and extract structured information. Return ONLY valid JSON, no markdown.

Resume text:
---
{}
---

Return this exact JSON structure:
{{
  "skills": ["skill1", "skill2", ...],
  "experience": [
    {{"title": "Job Title", "company": "Company Name", "duration": "2020 - 2023", "description": "Brief description"}}
  ],
  "education": [
    {{"degree": "Degree Name", "institution": "School Name", "year": "2020"}}
  ],
  "languages": [
    {{"name": "English", "level": "Native"}},
    {{"name": "German", "level": "B1"}}
  ]
}}

Rules:
- Extract ALL technical skills (programming languages, frameworks, tools, platforms, methodologies)
- Include soft skills only if explicitly listed
- For experience: include every role mentioned, newest first
- For education: include all degrees/certifications
- For languages: include all with proficiency levels
- If something is unclear, make your best guess from context"#,
        truncated
    );

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Claude API error ({}): {}", status, body));
    }

    let response: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let text = response["content"][0]["text"]
        .as_str()
        .unwrap_or("{}");

    // Strip markdown code fences if present
    let json_str = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    #[derive(Deserialize)]
    struct AiParsed {
        #[serde(default)]
        skills: Vec<String>,
        #[serde(default)]
        experience: Vec<serde_json::Value>,
        #[serde(default)]
        education: Vec<serde_json::Value>,
        #[serde(default)]
        languages: Vec<serde_json::Value>,
    }

    let ai: AiParsed = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI response: {} — raw: {}", e, json_str))?;

    let experience: Vec<Experience> = ai
        .experience
        .into_iter()
        .filter_map(|v| {
            Some(Experience {
                title: v.get("title")?.as_str()?.to_string(),
                company: v.get("company")?.as_str()?.to_string(),
                duration: v
                    .get("duration")
                    .or_else(|| v.get("period"))
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
                description: v
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect();

    let education: Vec<Education> = ai
        .education
        .into_iter()
        .filter_map(|v| {
            Some(Education {
                degree: v.get("degree")?.as_str()?.to_string(),
                institution: v
                    .get("institution")
                    .or_else(|| v.get("school"))
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
                year: v
                    .get("year")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect();

    let languages: Vec<LanguageEntry> = ai
        .languages
        .into_iter()
        .filter_map(|v| {
            Some(LanguageEntry {
                name: v.get("name")?.as_str()?.to_string(),
                level: v.get("level")?.as_str()?.to_string(),
            })
        })
        .collect();

    Ok(ParsedResume {
        full_text: full_text.to_string(),
        skills: ai.skills,
        experience,
        education,
        languages,
    })
}

#[tauri::command]
pub async fn upload_resume(
    state: State<'_, AppState>,
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

    // Try AI parsing if API key is available
    let api_key = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'anthropic_api_key'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_default()
    };

    let parsed = if !api_key.is_empty() {
        match parse_resume_with_ai(&api_key, &full_text).await {
            Ok(p) => {
                eprintln!("[resume] AI parsed: {} skills, {} experience, {} education, {} languages",
                    p.skills.len(), p.experience.len(), p.education.len(), p.languages.len());
                p
            }
            Err(e) => {
                eprintln!("[resume] AI parsing failed, using empty: {}", e);
                ParsedResume {
                    full_text: full_text.clone(),
                    skills: Vec::new(),
                    experience: Vec::new(),
                    education: Vec::new(),
                    languages: Vec::new(),
                }
            }
        }
    } else {
        eprintln!("[resume] No API key, skipping AI parsing");
        ParsedResume {
            full_text,
            skills: Vec::new(),
            experience: Vec::new(),
            education: Vec::new(),
            languages: Vec::new(),
        }
    };

    let parsed_json = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;

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
pub async fn reparse_resume(state: State<'_, AppState>) -> Result<ResumeData, String> {
    let (id, file_name, raw_file, target_roles) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let resume = crate::db::resume::get_resume(&db.conn)
            .map_err(|e| e.to_string())?
            .ok_or("No resume found")?;
        let raw = crate::db::resume::get_resume_raw_file(&db.conn, resume.id)
            .map_err(|e| e.to_string())?
            .ok_or("No resume file data found")?;
        (resume.id, resume.file_name.unwrap_or_default(), raw, resume.target_roles.unwrap_or_else(|| "[]".into()))
    };

    let full_text = if file_name.ends_with(".pdf") {
        extract_text_from_pdf(&raw_file)?
    } else if file_name.ends_with(".docx") {
        extract_text_from_docx(&raw_file)?
    } else {
        return Err("Unsupported file type".into());
    };

    let api_key = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.conn
            .query_row("SELECT value FROM settings WHERE key = 'anthropic_api_key'", [], |row| row.get::<_, String>(0))
            .unwrap_or_default()
    };

    if api_key.is_empty() {
        return Err("Anthropic API key is required for AI resume parsing. Set it in Settings.".into());
    }

    let parsed = parse_resume_with_ai(&api_key, &full_text).await.map_err(|e| format!("AI parsing failed: {}", e))?;
    let parsed_json = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        crate::db::resume::update_resume_parsed(&db.conn, id, &parsed_json, &target_roles)
            .map_err(|e| e.to_string())?;
    }

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
