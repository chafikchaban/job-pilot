use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashSet;

pub struct ArbeitnowSource {
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct ArbeitnowResponse {
    data: Vec<ArbeitnowJob>,
}

#[derive(Deserialize)]
struct ArbeitnowJob {
    slug: String,
    title: String,
    company_name: Option<String>,
    location: Option<String>,
    description: Option<String>,
    url: Option<String>,
    remote: Option<bool>,
    created_at: Option<i64>,
}

/// Extract individual search words from keywords for word-level matching.
/// e.g. ["Senior Frontend Engineer", "React Native Developer"]
///   -> ["frontend", "engineer", "react", "native", "developer"]
fn extract_search_words(keywords: &[String]) -> Vec<String> {
    let stop_words: HashSet<&str> =
        ["senior", "junior", "lead", "staff", "principal", "mid", "level", "full-stack", "and", "the", "for"]
            .iter()
            .copied()
            .collect();

    keywords
        .iter()
        .flat_map(|k| k.split_whitespace())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() > 2 && !stop_words.contains(w.as_str()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

impl ArbeitnowSource {
    pub fn new() -> Self {
        Self {
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl JobSource for ArbeitnowSource {
    fn name(&self) -> &str {
        "arbeitnow"
    }
    fn source_type(&self) -> SourceType {
        SourceType::Api
    }
    fn requires_api_key(&self) -> bool {
        false
    }

    async fn fetch_jobs(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<RawJobListing>, Box<dyn std::error::Error + Send + Sync>> {
        let url = "https://www.arbeitnow.com/api/job-board-api";

        let resp = self
            .client
            .get(url)
            .send()
            .await?
            .json::<ArbeitnowResponse>()
            .await?;

        // Split role titles into individual words for matching
        let search_words = extract_search_words(&query.keywords);

        let jobs = resp
            .data
            .into_iter()
            .filter(|j| {
                if search_words.is_empty() {
                    return true;
                }
                let title_lower = j.title.to_lowercase();
                let desc_lower = j
                    .description
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase();
                // Match if ANY individual word appears in title or description
                search_words
                    .iter()
                    .any(|w| title_lower.contains(w) || desc_lower.contains(w))
            })
            .take(query.per_page as usize)
            .map(|j| {
                let remote_policy = if j.remote.unwrap_or(false) {
                    Some("remote".into())
                } else {
                    None
                };
                let job_url = j.url.unwrap_or_else(|| {
                    format!("https://www.arbeitnow.com/view/{}", j.slug)
                });

                RawJobListing {
                    title: j.title,
                    company: j.company_name,
                    location: j.location,
                    remote_policy,
                    description: j.description,
                    url: job_url,
                    apply_url: None,
                    source: "arbeitnow".into(),
                    language: Some("de".into()),
                    posted_at: j.created_at.and_then(|ts| {
                        DateTime::<Utc>::from_timestamp(ts, 0)
                            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    }),
                    raw_json: None,
                }
            })
            .collect();

        Ok(jobs)
    }
}
