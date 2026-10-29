use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeRow {
    pub id: i64,
    pub file_name: Option<String>,
    pub parsed_json: Option<String>,
    pub target_roles: Option<String>,
    pub updated_at: Option<String>,
}

pub fn insert_resume(
    conn: &Connection,
    raw_file: &[u8],
    file_name: &str,
    parsed_json: &str,
    target_roles: &str,
) -> Result<i64, rusqlite::Error> {
    // Only keep one resume at a time - delete existing
    conn.execute("DELETE FROM resume", [])?;
    conn.execute(
        "INSERT INTO resume (raw_file, file_name, parsed_json, target_roles, updated_at) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
        params![raw_file, file_name, parsed_json, target_roles],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_resume(conn: &Connection) -> Result<Option<ResumeRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, file_name, parsed_json, target_roles, updated_at FROM resume ORDER BY id DESC LIMIT 1",
    )?;
    stmt.query_row([], |row| {
        Ok(ResumeRow {
            id: row.get(0)?,
            file_name: row.get(1)?,
            parsed_json: row.get(2)?,
            target_roles: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })
    .optional()
}

pub fn update_resume_parsed(
    conn: &Connection,
    id: i64,
    parsed_json: &str,
    target_roles: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE resume SET parsed_json = ?1, target_roles = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
        params![parsed_json, target_roles, id],
    )?;
    Ok(())
}

pub fn get_resume_raw_file(conn: &Connection, id: i64) -> Result<Option<Vec<u8>>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT raw_file FROM resume WHERE id = ?1")?;
    stmt.query_row(params![id], |row| row.get::<_, Vec<u8>>(0))
        .optional()
}

pub fn delete_resume(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM resume WHERE id = ?1", params![id])?;
    Ok(())
}
