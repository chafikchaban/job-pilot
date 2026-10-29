pub mod adzuna;
pub mod the_muse;
pub mod remotive;
pub mod arbeitnow;
pub mod jsearch;
pub mod linkedin;
pub mod stepstone;
pub mod brave_search;
pub mod search_templates;
pub mod orchestrator;
pub mod query_builder;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SourceType {
    Api,
    Scraper,
    WebSearch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub keywords: Vec<String>,
    pub location: Option<String>,
    pub remote_policy: Option<String>,
    pub date_range_days: Option<u32>,
    pub language: Option<String>,
    pub page: u32,
    pub per_page: u32,
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            keywords: vec!["software engineer".into()],
            location: Some("Germany".into()),
            remote_policy: Some("remote".into()),
            date_range_days: Some(7),
            language: Some("en".into()),
            page: 1,
            per_page: 20,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawJobListing {
    pub title: String,
    pub company: Option<String>,
    pub location: Option<String>,
    pub remote_policy: Option<String>,
    pub description: Option<String>,
    pub url: String,
    pub apply_url: Option<String>,
    pub source: String,
    pub language: Option<String>,
    pub posted_at: Option<String>,
    pub raw_json: Option<String>,
}

impl RawJobListing {
    pub fn dedup_hash(&self) -> String {
        let input = format!(
            "{}{}{}",
            self.title.to_lowercase(),
            self.company.as_deref().unwrap_or("").to_lowercase(),
            self.location.as_deref().unwrap_or("").to_lowercase(),
        );
        let hash = Sha256::digest(input.as_bytes());
        hex::encode(hash)
    }
}

/// Resolve a scraper script path relative to the project root.
/// CARGO_MANIFEST_DIR is src-tauri/ at compile time; scripts live one level up.
pub fn resolve_script_path(script_name: &str) -> PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest.parent().unwrap_or(manifest);
    project_root.join("scripts").join(script_name)
}

/// Get the app data directory for storing session files etc.
pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.jobpilot.app")
}

/// Build a shared HTTP client with proper User-Agent header.
/// Some APIs (The Muse, Remotive) return 403 without a User-Agent.
pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("JobPilot/0.1 (Desktop App)")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

#[async_trait]
pub trait JobSource: Send + Sync {
    fn name(&self) -> &str;
    fn source_type(&self) -> SourceType;
    async fn fetch_jobs(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<RawJobListing>, Box<dyn std::error::Error + Send + Sync>>;
    fn requires_api_key(&self) -> bool;
}
