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

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
