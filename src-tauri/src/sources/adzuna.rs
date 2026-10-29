use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;

pub struct AdzunaSource {
    app_id: String,
    app_key: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct AdzunaResponse {
    results: Vec<AdzunaJob>,
}

#[derive(Deserialize)]
struct AdzunaJob {
    title: String,
    description: Option<String>,
    company: Option<AdzunaCompany>,
    location: Option<AdzunaLocation>,
    redirect_url: String,
    created: Option<String>,
}

#[derive(Deserialize)]
struct AdzunaCompany {
    display_name: String,
}

#[derive(Deserialize)]
struct AdzunaLocation {
    display_name: String,
}

impl AdzunaSource {
    pub fn new(app_id: String, app_key: String) -> Self {
        Self {
            app_id,
            app_key,
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl JobSource for AdzunaSource {
    fn name(&self) -> &str {
        "adzuna"
    }
    fn source_type(&self) -> SourceType {
        SourceType::Api
    }
    fn requires_api_key(&self) -> bool {
        true
    }

    async fn fetch_jobs(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<RawJobListing>, Box<dyn std::error::Error + Send + Sync>> {
        let country = "de";
        let keywords = query.keywords.join(" ");
        let url = format!(
            "https://api.adzuna.com/v1/api/jobs/{}/search/{}",
            country, query.page
        );

        let resp = self
            .client
            .get(&url)
            .query(&[
                ("app_id", self.app_id.as_str()),
                ("app_key", self.app_key.as_str()),
                ("what", &keywords),
                ("results_per_page", &query.per_page.to_string()),
            ])
            .send()
            .await?
            .json::<AdzunaResponse>()
            .await?;

        let jobs = resp
            .results
            .into_iter()
            .map(|j| RawJobListing {
                title: j.title,
                company: j.company.map(|c| c.display_name),
                location: j.location.map(|l| l.display_name),
                remote_policy: None,
                description: j.description,
                url: j.redirect_url,
                apply_url: None,
                source: "adzuna".into(),
                language: Some("en".into()),
                posted_at: j.created,
                raw_json: None,
            })
            .collect();

        Ok(jobs)
    }
}
