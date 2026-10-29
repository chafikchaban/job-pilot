use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;

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

impl RemotiveSource {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
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
        let keywords = query.keywords.join(" ");

        let resp = self
            .client
            .get(url)
            .query(&[("search", &keywords)])
            .send()
            .await?
            .json::<RemotiveResponse>()
            .await?;

        let jobs = resp
            .jobs
            .into_iter()
            .take(query.per_page as usize)
            .map(|j| RawJobListing {
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
            })
            .collect();

        Ok(jobs)
    }
}
