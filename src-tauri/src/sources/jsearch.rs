use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use serde::Deserialize;

pub struct JSearchSource {
    api_key: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct JSearchResponse {
    data: Option<Vec<JSearchJob>>,
}

#[derive(Deserialize)]
struct JSearchJob {
    job_title: Option<String>,
    employer_name: Option<String>,
    job_city: Option<String>,
    job_country: Option<String>,
    job_description: Option<String>,
    job_apply_link: Option<String>,
    job_posted_at_datetime_utc: Option<String>,
    job_is_remote: Option<bool>,
}

impl JSearchSource {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl JobSource for JSearchSource {
    fn name(&self) -> &str {
        "jsearch"
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
        let url = "https://jsearch.p.rapidapi.com/search";
        let keywords = query.keywords.join(" ");
        let q = if let Some(loc) = &query.location {
            format!("{} in {}", keywords, loc)
        } else {
            keywords
        };

        let resp = self
            .client
            .get(url)
            .header("X-RapidAPI-Key", &self.api_key)
            .header("X-RapidAPI-Host", "jsearch.p.rapidapi.com")
            .query(&[
                ("query", q.as_str()),
                ("page", &query.page.to_string()),
                ("num_pages", "1"),
            ])
            .send()
            .await?
            .json::<JSearchResponse>()
            .await?;

        let jobs = resp
            .data
            .unwrap_or_default()
            .into_iter()
            .take(query.per_page as usize)
            .filter_map(|j| {
                let title = j.job_title?;
                let apply_link = j.job_apply_link.clone().unwrap_or_default();
                let location = match (&j.job_city, &j.job_country) {
                    (Some(city), Some(country)) => Some(format!("{}, {}", city, country)),
                    (None, Some(country)) => Some(country.clone()),
                    (Some(city), None) => Some(city.clone()),
                    _ => None,
                };
                let remote_policy = if j.job_is_remote.unwrap_or(false) {
                    Some("remote".into())
                } else {
                    None
                };

                Some(RawJobListing {
                    title,
                    company: j.employer_name,
                    location,
                    remote_policy,
                    description: j.job_description,
                    url: apply_link.clone(),
                    apply_url: Some(apply_link),
                    source: "jsearch".into(),
                    language: Some("en".into()),
                    posted_at: j.job_posted_at_datetime_utc,
                    raw_json: None,
                })
            })
            .collect();

        Ok(jobs)
    }
}
