use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationWithJob {
    pub id: i64,
    pub job_id: i64,
    pub status: String,
    pub applied_at: Option<String>,
    pub notes: Option<String>,
    pub follow_up_date: Option<String>,
    pub cover_letter_id: Option<i64>,
    pub updated_at: Option<String>,
    pub job_title: String,
    pub job_company: Option<String>,
    pub job_url: String,
}

pub fn create_application(conn: &Connection, job_id: i64) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO applications (job_id, status, updated_at) VALUES (?1, 'interested', CURRENT_TIMESTAMP)",
        params![job_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_applications(
    conn: &Connection,
    status_filter: Option<&str>,
) -> Result<Vec<ApplicationWithJob>, rusqlite::Error> {
    let sql = if let Some(status) = status_filter {
        format!(
            "SELECT a.id, a.job_id, a.status, a.applied_at, a.notes, a.follow_up_date, a.cover_letter_id, a.updated_at, j.title, j.company, j.url
             FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.status = '{}' ORDER BY a.updated_at DESC",
            status
        )
    } else {
        "SELECT a.id, a.job_id, a.status, a.applied_at, a.notes, a.follow_up_date, a.cover_letter_id, a.updated_at, j.title, j.company, j.url
         FROM applications a JOIN jobs j ON a.job_id = j.id ORDER BY a.updated_at DESC".to_string()
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ApplicationWithJob {
                id: row.get(0)?,
                job_id: row.get(1)?,
                status: row.get(2)?,
                applied_at: row.get(3)?,
                notes: row.get(4)?,
                follow_up_date: row.get(5)?,
                cover_letter_id: row.get(6)?,
                updated_at: row.get(7)?,
                job_title: row.get(8)?,
                job_company: row.get(9)?,
                job_url: row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get_application(
    conn: &Connection,
    id: i64,
) -> Result<Option<ApplicationWithJob>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.job_id, a.status, a.applied_at, a.notes, a.follow_up_date, a.cover_letter_id, a.updated_at, j.title, j.company, j.url
         FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(ApplicationWithJob {
            id: row.get(0)?,
            job_id: row.get(1)?,
            status: row.get(2)?,
            applied_at: row.get(3)?,
            notes: row.get(4)?,
            follow_up_date: row.get(5)?,
            cover_letter_id: row.get(6)?,
            updated_at: row.get(7)?,
            job_title: row.get(8)?,
            job_company: row.get(9)?,
            job_url: row.get(10)?,
        })
    })
    .optional()
}

pub fn update_application_status(
    conn: &Connection,
    id: i64,
    status: &str,
) -> Result<(), rusqlite::Error> {
    if status == "applied" {
        conn.execute(
            "UPDATE applications SET status = ?1, applied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![status, id],
        )?;
    } else {
        conn.execute(
            "UPDATE applications SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![status, id],
        )?;
    }
    Ok(())
}

pub fn update_application_notes(
    conn: &Connection,
    id: i64,
    notes: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE applications SET notes = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![notes, id],
    )?;
    Ok(())
}

pub fn set_follow_up_date(
    conn: &Connection,
    id: i64,
    date: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE applications SET follow_up_date = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![date, id],
    )?;
    Ok(())
}

pub fn link_cover_letter(
    conn: &Connection,
    app_id: i64,
    cl_id: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE applications SET cover_letter_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![cl_id, app_id],
    )?;
    Ok(())
}

pub fn delete_application(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM applications WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_application_stats(
    conn: &Connection,
) -> Result<HashMap<String, u32>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM applications GROUP BY status")?;
    let mut stats = HashMap::new();
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)))?;
    for row in rows {
        if let Ok((status, count)) = row {
            stats.insert(status, count);
        }
    }
    Ok(stats)
}
