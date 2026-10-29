use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashSet;

pub struct RemotiveSource {
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct RemotiveResponse {
    jobs: Vec<RemotiveJob>,
}

#[derive(Deserialize)]
struct RemotiveJob {
    title: String,
    company_name: Option<String>,
    candidate_required_location: Option<String>,
    description: Option<String>,
    url: String,
    publication_date: Option<String>,
}

/// Extract individual meaningful search terms from role-based keywords.
/// e.g. ["Senior Frontend Engineer", "React Native Developer"]
///   -> ["frontend", "engineer", "react", "native", "developer"]
fn extract_search_terms(keywords: &[String]) -> Vec<String> {
    let stop_words: HashSet<&str> =
        ["senior", "junior", "lead", "staff", "principal", "mid", "level", "full-stack"]
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

impl RemotiveSource {
    pub fn new() -> Self {
        Self {
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl JobSource for RemotiveSource {
    fn name(&self) -> &str {
        "remotive"
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
        let url = "https://remotive.com/api/remote-jobs";
        let search_terms = extract_search_terms(&query.keywords);

        // Search each term individually and merge results
        let mut seen_urls = HashSet::new();
        let mut all_jobs = Vec::new();

        for term in &search_terms {
            if all_jobs.len() >= query.per_page as usize {
                break;
            }

            let resp = self
                .client
                .get(url)
                .query(&[("search", term.as_str())])
                .send()
                .await?
                .json::<RemotiveResponse>()
                .await?;

            for j in resp.jobs {
                if seen_urls.contains(&j.url) {
                    continue;
                }
                seen_urls.insert(j.url.clone());
                all_jobs.push(RawJobListing {
                    title: j.title,
                    company: j.company_name,
                    location: j.candidate_required_location,
                    remote_policy: Some("remote".into()),
                    description: j.description,
                    url: j.url,
                    apply_url: None,
                    source: "remotive".into(),
                    language: Some("en".into()),
                    posted_at: j.publication_date,
                    raw_json: None,
                });

                if all_jobs.len() >= query.per_page as usize {
                    break;
                }
            }
        }

        Ok(all_jobs)
    }
}
