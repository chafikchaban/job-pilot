use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashSet;

pub struct TheMuseSource {
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct MuseResponse {
    results: Vec<MuseJob>,
}

#[derive(Deserialize)]
struct MuseJob {
    name: String,
    contents: Option<String>,
    company: Option<MuseCompany>,
    locations: Vec<MuseLocation>,
    refs: Option<MuseRefs>,
    publication_date: Option<String>,
}

#[derive(Deserialize)]
struct MuseCompany {
    name: String,
}

#[derive(Deserialize)]
struct MuseLocation {
    name: String,
}

#[derive(Deserialize)]
struct MuseRefs {
    landing_page: Option<String>,
}

/// The Muse API uses fixed category names, not free-text search.
/// Map common role keywords to Muse categories.
fn keywords_to_muse_categories(keywords: &[String]) -> Vec<&'static str> {
    let joined = keywords.join(" ").to_lowercase();
    let mut categories = Vec::new();

    // Always include Software Engineering for dev roles
    if joined.contains("engineer")
        || joined.contains("developer")
        || joined.contains("frontend")
        || joined.contains("backend")
        || joined.contains("full-stack")
        || joined.contains("fullstack")
        || joined.contains("software")
        || joined.contains("react")
        || joined.contains("typescript")
    {
        categories.push("Software Engineering");
    }

    if joined.contains("data") || joined.contains("analytics") || joined.contains("machine learning") {
        categories.push("Data and Analytics");
    }

    if joined.contains("design") || joined.contains("ux") || joined.contains("ui") {
        categories.push("Design and UX");
    }

    if joined.contains("product") || joined.contains("manager") {
        categories.push("Product");
    }

    if joined.contains("devops") || joined.contains("infrastructure") || joined.contains("cloud") {
        categories.push("Software Engineering");
    }

    // Deduplicate
    categories.sort();
    categories.dedup();

    // Fallback: if no category matched, use Software Engineering
    if categories.is_empty() {
        categories.push("Software Engineering");
    }

    categories
}

/// Extract individual search words from keywords for client-side filtering.
fn extract_search_words(keywords: &[String]) -> Vec<String> {
    let stop_words: HashSet<&str> =
        ["senior", "junior", "lead", "staff", "principal", "mid", "level"].iter().copied().collect();

    keywords
        .iter()
        .flat_map(|k| k.split_whitespace())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() > 2 && !stop_words.contains(w.as_str()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

impl TheMuseSource {
    pub fn new() -> Self {
        Self {
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl JobSource for TheMuseSource {
    fn name(&self) -> &str {
        "themuse"
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
        let url = "https://www.themuse.com/api/public/jobs";
        let categories = keywords_to_muse_categories(&query.keywords);
        let search_words = extract_search_words(&query.keywords);

        // Build query params — The Muse supports multiple category params
        let mut params: Vec<(&str, String)> = vec![
            ("page", query.page.to_string()),
        ];
        for cat in &categories {
            params.push(("category", cat.to_string()));
        }

        let resp = self
            .client
            .get(url)
            .query(&params)
            .send()
            .await?
            .json::<MuseResponse>()
            .await?;

        let jobs: Vec<RawJobListing> = resp
            .results
            .into_iter()
            .filter(|j| {
                // Client-side filter: job title or description must contain at least one keyword word
                if search_words.is_empty() {
                    return true;
                }
                let title_lower = j.name.to_lowercase();
                let desc_lower = j
                    .contents
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase();
                search_words
                    .iter()
                    .any(|w| title_lower.contains(w) || desc_lower.contains(w))
            })
            .take(query.per_page as usize)
            .map(|j| {
                let location = j.locations.first().map(|l| l.name.clone());
                let url = j
                    .refs
                    .and_then(|r| r.landing_page)
                    .unwrap_or_default();

                RawJobListing {
                    title: j.name,
                    company: j.company.map(|c| c.name),
                    location,
                    remote_policy: None,
                    description: j.contents,
                    url,
                    apply_url: None,
                    source: "themuse".into(),
                    language: Some("en".into()),
                    posted_at: j.publication_date,
                    raw_json: None,
                }
            })
            .collect();

        Ok(jobs)
    }
}
