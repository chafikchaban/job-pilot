use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS resume (
            id INTEGER PRIMARY KEY,
            raw_file BLOB,
            file_name TEXT,
            parsed_json TEXT,
            target_roles TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            company TEXT,
            location TEXT,
            remote_policy TEXT,
            description TEXT,
            url TEXT NOT NULL,
            apply_url TEXT,
            source TEXT NOT NULL,
            language TEXT,
            german_level_required TEXT DEFAULT 'none',
            posted_at DATETIME,
            fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            relevance_score REAL DEFAULT 0.0,
            dedup_hash TEXT UNIQUE,
            raw_json TEXT
        );

        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY,
            job_id INTEGER REFERENCES jobs(id),
            status TEXT DEFAULT 'interested',
            applied_at DATETIME,
            notes TEXT,
            follow_up_date DATETIME,
            cover_letter_id INTEGER REFERENCES cover_letters(id),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cover_letters (
            id INTEGER PRIMARY KEY,
            job_id INTEGER REFERENCES jobs(id),
            content TEXT,
            language TEXT,
            tone TEXT,
            generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            edited_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS scan_log (
            id INTEGER PRIMARY KEY,
            source TEXT,
            jobs_found INTEGER DEFAULT 0,
            jobs_new INTEGER DEFAULT 0,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_dedup_hash ON jobs(dedup_hash);
        CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
        CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs(relevance_score DESC);
        CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
        CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);

        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            total_found INTEGER DEFAULT 0,
            new_inserted INTEGER DEFAULT 0,
            pipeline_stats TEXT,
            errors TEXT,
            status TEXT DEFAULT 'running'
        );
        ",
    )?;

    // Add match_reason and ai_scored columns (idempotent)
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(jobs)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !columns.iter().any(|c| c == "match_reason") {
        conn.execute("ALTER TABLE jobs ADD COLUMN match_reason TEXT", [])?;
    }
    if !columns.iter().any(|c| c == "ai_scored") {
        conn.execute("ALTER TABLE jobs ADD COLUMN ai_scored INTEGER DEFAULT 0", [])?;
    }
    if !columns.iter().any(|c| c == "parsed_info") {
        conn.execute("ALTER TABLE jobs ADD COLUMN parsed_info TEXT", [])?;
    }
    if !columns.iter().any(|c| c == "scan_id") {
        conn.execute(
            "ALTER TABLE jobs ADD COLUMN scan_id INTEGER REFERENCES scans(id)",
            [],
        )?;
    }

    // Add scan_id column to scan_log (idempotent)
    let scan_log_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(scan_log)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !scan_log_columns.iter().any(|c| c == "scan_id") {
        conn.execute(
            "ALTER TABLE scan_log ADD COLUMN scan_id INTEGER REFERENCES scans(id)",
            [],
        )?;
    }

    // Migrate scores from 0-1 scale to 0-100 scale (idempotent: only affects scores <= 1.0)
    conn.execute(
        "UPDATE jobs SET relevance_score = ROUND(relevance_score * 100) WHERE relevance_score > 0.0 AND relevance_score <= 1.0",
        [],
    )?;

    // Seed default settings
    let defaults = vec![
        ("adzuna_app_id", ""),
        ("adzuna_app_key", ""),
        ("rapidapi_key", ""),
        ("brave_search_api_key", ""),
        ("anthropic_api_key", ""),
        ("scan_cron_expression", "0 0 */6 * * *"),
        ("scan_enabled", "false"),
        ("target_roles", r#"["Senior Frontend Engineer","Full-Stack TypeScript Developer","React Native Developer"]"#),
        ("preferred_remote_policy", "remote"),
        ("accept_hybrid", "true"),
        ("regions", r#"["Germany","EU"]"#),
        ("languages", r#"["en","de"]"#),
        ("german_level", "B1"),
        ("excluded_companies", "[]"),
        ("excluded_keywords", "[]"),
        ("cover_letter_tone", "professional"),
        ("cover_letter_style", "concise"),
        ("source_adzuna_enabled", "true"),
        ("source_themuse_enabled", "true"),
        ("source_remotive_enabled", "true"),
        ("source_arbeitnow_enabled", "true"),
        ("source_jsearch_enabled", "true"),
        ("source_linkedin_enabled", "true"),
        ("source_stepstone_enabled", "true"),
        ("source_brave_search_enabled", "false"),
        ("linkedin_max_pages", "3"),
        ("stepstone_max_pages", "3"),
        ("custom_scraper_boards", "[]"),
        ("ai_filter_enabled", "true"),
        ("ai_filter_threshold", "40"),
        ("mcp_server_enabled", "false"),
        ("mcp_server_port", "3333"),
    ];

    for (key, value) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }

    Ok(())
}
