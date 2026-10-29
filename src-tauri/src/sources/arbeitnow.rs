use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;

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
    created_at: Option<String>,
}

impl ArbeitnowSource {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
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

        let keywords_lower: Vec<String> = query.keywords.iter().map(|k| k.to_lowercase()).collect();

        let jobs = resp
            .data
            .into_iter()
            .filter(|j| {
                let title_lower = j.title.to_lowercase();
                let desc_lower = j
                    .description
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase();
                keywords_lower
                    .iter()
                    .any(|k| title_lower.contains(k) || desc_lower.contains(k))
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
                    posted_at: j.created_at,
                    raw_json: None,
                }
            })
            .collect();

        Ok(jobs)
    }
}
