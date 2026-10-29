use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;

pub struct BraveSearchSource {
    api_key: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct BraveResponse {
    web: Option<BraveWeb>,
}

#[derive(Deserialize)]
struct BraveWeb {
    results: Vec<BraveResult>,
}

#[derive(Deserialize)]
struct BraveResult {
    title: String,
    url: String,
    description: Option<String>,
    age: Option<String>,
}

impl BraveSearchSource {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl JobSource for BraveSearchSource {
    fn name(&self) -> &str {
        "brave_search"
    }
    fn source_type(&self) -> SourceType {
        SourceType::WebSearch
    }
    fn requires_api_key(&self) -> bool {
        true
    }

    async fn fetch_jobs(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<RawJobListing>, Box<dyn std::error::Error + Send + Sync>> {
        let keywords = query.keywords.join(" ");
        let search_query = if let Some(loc) = &query.location {
            format!("{} job {} remote", keywords, loc)
        } else {
            format!("{} job remote", keywords)
        };

        let resp = self
            .client
            .get("https://api.search.brave.com/res/v1/web/search")
            .header("X-Subscription-Token", &self.api_key)
            .query(&[
                ("q", search_query.as_str()),
                ("count", &query.per_page.to_string()),
            ])
            .send()
            .await?
            .json::<BraveResponse>()
            .await?;

        let results = resp.web.map(|w| w.results).unwrap_or_default();

        let jobs = results
            .into_iter()
            .map(|r| RawJobListing {
                title: r.title,
                company: None,
                location: query.location.clone(),
                remote_policy: Some("remote".into()),
                description: r.description,
                url: r.url,
                apply_url: None,
                source: "brave_search".into(),
                language: query.language.clone(),
                posted_at: r.age,
                raw_json: None,
            })
            .collect();

        Ok(jobs)
    }
}
