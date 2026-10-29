use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;

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

impl TheMuseSource {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
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
        let keywords = query.keywords.join(" ");

        let resp = self
            .client
            .get(url)
            .query(&[
                ("page", &query.page.to_string()),
                ("category", &keywords),
            ])
            .send()
            .await?
            .json::<MuseResponse>()
            .await?;

        let jobs = resp
            .results
            .into_iter()
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
