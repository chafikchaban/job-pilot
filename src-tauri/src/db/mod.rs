mod migrate;
pub mod resume;
pub mod jobs;
pub mod applications;
pub mod cover_letters;

use rusqlite::Connection;
use std::path::PathBuf;

pub struct Database {
    pub conn: Connection,
}

impl Database {
    pub fn new() -> Result<Self, rusqlite::Error> {
        let db_path = Self::db_path();
        std::fs::create_dir_all(db_path.parent().unwrap()).ok();
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrate::run_migrations(&conn)?;
        Ok(Self { conn })
    }

    pub fn db_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("com.jobpilot.app");
        path.push("jobpilot.db");
        path
    }
}
