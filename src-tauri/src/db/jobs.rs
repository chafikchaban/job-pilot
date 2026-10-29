use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::sources::RawJobListing;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRow {
    pub id: i64,
    pub title: String,
    pub company: Option<String>,
    pub location: Option<String>,
    pub remote_policy: Option<String>,
    pub description: Option<String>,
    pub url: String,
    pub apply_url: Option<String>,
    pub source: String,
    pub language: Option<String>,
    pub german_level_required: Option<String>,
    pub posted_at: Option<String>,
    pub fetched_at: Option<String>,
    pub relevance_score: Option<f64>,
    pub dedup_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JobFilters {
    pub search: Option<String>,
    pub sources: Option<Vec<String>>,
    pub remote_policy: Option<Vec<String>>,
    pub min_relevance: Option<f64>,
    pub language: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanLogRow {
    pub id: i64,
    pub source: String,
    pub jobs_found: i64,
    pub jobs_new: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

/// Insert a job, returns true if new (inserted), false if duplicate (skipped)
pub fn insert_job(conn: &Connection, job: &RawJobListing) -> Result<bool, rusqlite::Error> {
    let hash = job.dedup_hash();
    let result = conn.execute(
        "INSERT OR IGNORE INTO jobs (title, company, location, remote_policy, description, url, apply_url, source, language, posted_at, dedup_hash, raw_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)",
        params![
            job.title,
            job.company,
            job.location,
            job.remote_policy,
            job.description,
            job.url,
            job.apply_url,
            job.source,
            job.language,
            job.posted_at,
            hash,
            job.raw_json,
        ],
    )?;
    Ok(result > 0)
}

pub fn get_jobs(
    conn: &Connection,
    filters: &JobFilters,
) -> Result<(Vec<JobRow>, u32), rusqlite::Error> {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(search) = &filters.search {
        if !search.is_empty() {
            where_clauses.push(
                "(title LIKE ?N OR company LIKE ?N OR description LIKE ?N)".to_string(),
            );
            let like = format!("%{}%", search);
            param_values.push(Box::new(like));
        }
    }

    if let Some(sources) = &filters.sources {
        if !sources.is_empty() {
            let placeholders: Vec<String> = sources.iter().map(|_| "?N".to_string()).collect();
            where_clauses.push(format!("source IN ({})", placeholders.join(",")));
            for s in sources {
                param_values.push(Box::new(s.clone()));
            }
        }
    }

    if let Some(policies) = &filters.remote_policy {
        if !policies.is_empty() {
            let placeholders: Vec<String> = policies.iter().map(|_| "?N".to_string()).collect();
            where_clauses.push(format!("remote_policy IN ({})", placeholders.join(",")));
            for p in policies {
                param_values.push(Box::new(p.clone()));
            }
        }
    }

    if let Some(min) = filters.min_relevance {
        where_clauses.push("relevance_score >= ?N".to_string());
        param_values.push(Box::new(min));
    }

    if let Some(lang) = &filters.language {
        if !lang.is_empty() {
            where_clauses.push("language = ?N".to_string());
            param_values.push(Box::new(lang.clone()));
        }
    }

    if let Some(from) = &filters.date_from {
        if !from.is_empty() {
            where_clauses.push("fetched_at >= ?N".to_string());
            param_values.push(Box::new(from.clone()));
        }
    }

    if let Some(to) = &filters.date_to {
        if !to.is_empty() {
            where_clauses.push("fetched_at <= ?N".to_string());
            param_values.push(Box::new(to.clone()));
        }
    }

    // Build the numbered parameter SQL
    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        // Replace ?N placeholders with numbered params
        let mut idx = 1;
        let mut clauses = Vec::new();
        for clause in &where_clauses {
            let mut c = clause.clone();
            while c.contains("?N") {
                c = c.replacen("?N", &format!("?{}", idx), 1);
                idx += 1;
            }
            clauses.push(c);
        }
        format!("WHERE {}", clauses.join(" AND "))
    };

    let sort = match filters.sort_by.as_deref() {
        Some("relevance_score") => "relevance_score",
        Some("posted_at") => "posted_at",
        Some("title") => "title",
        _ => "fetched_at",
    };
    let order = match filters.sort_order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };
    let page = filters.page.unwrap_or(1).max(1);
    let per_page = filters.per_page.unwrap_or(20).min(100);
    let offset = (page - 1) * per_page;

    // Count query
    let count_sql = format!("SELECT COUNT(*) FROM jobs {}", where_sql);
    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let total: u32 = conn.query_row(&count_sql, params_ref.as_slice(), |row| row.get(0))?;

    // Data query
    let data_sql = format!(
        "SELECT id, title, company, location, remote_policy, description, url, apply_url, source, language, german_level_required, posted_at, fetched_at, relevance_score, dedup_hash
         FROM jobs {} ORDER BY {} {} LIMIT {} OFFSET {}",
        where_sql, sort, order, per_page, offset
    );

    let params_ref2: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&data_sql)?;
    let rows = stmt
        .query_map(params_ref2.as_slice(), |row| {
            Ok(JobRow {
                id: row.get(0)?,
                title: row.get(1)?,
                company: row.get(2)?,
                location: row.get(3)?,
                remote_policy: row.get(4)?,
                description: row.get(5)?,
                url: row.get(6)?,
                apply_url: row.get(7)?,
                source: row.get(8)?,
                language: row.get(9)?,
                german_level_required: row.get(10)?,
                posted_at: row.get(11)?,
                fetched_at: row.get(12)?,
                relevance_score: row.get(13)?,
                dedup_hash: row.get(14)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok((rows, total))
}

pub fn get_job_by_id(conn: &Connection, id: i64) -> Result<Option<JobRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, company, location, remote_policy, description, url, apply_url, source, language, german_level_required, posted_at, fetched_at, relevance_score, dedup_hash
         FROM jobs WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(JobRow {
            id: row.get(0)?,
            title: row.get(1)?,
            company: row.get(2)?,
            location: row.get(3)?,
            remote_policy: row.get(4)?,
            description: row.get(5)?,
            url: row.get(6)?,
            apply_url: row.get(7)?,
            source: row.get(8)?,
            language: row.get(9)?,
            german_level_required: row.get(10)?,
            posted_at: row.get(11)?,
            fetched_at: row.get(12)?,
            relevance_score: row.get(13)?,
            dedup_hash: row.get(14)?,
        })
    })
    .optional()
}

pub fn update_job_relevance(
    conn: &Connection,
    id: i64,
    score: f64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE jobs SET relevance_score = ?1 WHERE id = ?2",
        params![score, id],
    )?;
    Ok(())
}

pub fn get_job_count(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
}

pub fn insert_scan_log(
    conn: &Connection,
    source: &str,
    jobs_found: u32,
    jobs_new: u32,
    error: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO scan_log (source, jobs_found, jobs_new, completed_at, error) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, ?4)",
        params![source, jobs_found, jobs_new, error],
    )?;
    Ok(())
}

pub fn get_scan_logs(conn: &Connection, limit: u32) -> Result<Vec<ScanLogRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, source, jobs_found, jobs_new, started_at, completed_at, error FROM scan_log ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ScanLogRow {
                id: row.get(0)?,
                source: row.get(1)?,
                jobs_found: row.get(2)?,
                jobs_new: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn delete_all_jobs(conn: &Connection) -> Result<u64, rusqlite::Error> {
    let count = conn.execute("DELETE FROM jobs", [])?;
    Ok(count as u64)
}
