use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverLetterRow {
    pub id: i64,
    pub job_id: i64,
    pub content: String,
    pub language: String,
    pub tone: String,
    pub generated_at: String,
    pub edited_at: Option<String>,
}

pub fn insert_cover_letter(
    conn: &Connection,
    job_id: i64,
    content: &str,
    language: &str,
    tone: &str,
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO cover_letters (job_id, content, language, tone) VALUES (?1, ?2, ?3, ?4)",
        params![job_id, content, language, tone],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_cover_letters(
    conn: &Connection,
    job_id: Option<i64>,
) -> Result<Vec<CoverLetterRow>, rusqlite::Error> {
    let sql = if let Some(jid) = job_id {
        format!(
            "SELECT id, job_id, content, language, tone, generated_at, edited_at FROM cover_letters WHERE job_id = {} ORDER BY generated_at DESC",
            jid
        )
    } else {
        "SELECT id, job_id, content, language, tone, generated_at, edited_at FROM cover_letters ORDER BY generated_at DESC".to_string()
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CoverLetterRow {
                id: row.get(0)?,
                job_id: row.get(1)?,
                content: row.get(2)?,
                language: row.get(3)?,
                tone: row.get(4)?,
                generated_at: row.get(5)?,
                edited_at: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get_cover_letter(
    conn: &Connection,
    id: i64,
) -> Result<Option<CoverLetterRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, job_id, content, language, tone, generated_at, edited_at FROM cover_letters WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(CoverLetterRow {
            id: row.get(0)?,
            job_id: row.get(1)?,
            content: row.get(2)?,
            language: row.get(3)?,
            tone: row.get(4)?,
            generated_at: row.get(5)?,
            edited_at: row.get(6)?,
        })
    })
    .optional()
}

pub fn update_cover_letter_content(
    conn: &Connection,
    id: i64,
    content: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE cover_letters SET content = ?1, edited_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![content, id],
    )?;
    Ok(())
}

pub fn delete_cover_letter(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM cover_letters WHERE id = ?1", params![id])?;
    Ok(())
}
