use super::*;
use super::query_builder;
use std::collections::HashMap;

pub struct SourceOrchestrator {
    sources: Vec<Box<dyn JobSource>>,
    settings: HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScanResult {
    pub source: String,
    pub jobs_found: u32,
    pub jobs_new: u32,
    pub error: Option<String>,
}

impl SourceOrchestrator {
    pub fn new(settings: &HashMap<String, String>) -> Self {
        let mut sources: Vec<Box<dyn JobSource>> = Vec::new();

        // Adzuna - requires API key
        if let (Some(id), Some(key)) = (
            settings.get("adzuna_app_id"),
            settings.get("adzuna_app_key"),
        ) {
            if !id.is_empty()
                && !key.is_empty()
                && settings
                    .get("source_adzuna_enabled")
                    .map_or(true, |v| v == "true")
            {
                sources.push(Box::new(adzuna::AdzunaSource::new(
                    id.clone(),
                    key.clone(),
                )));
            }
        }

        // The Muse - no key required
        if settings
            .get("source_themuse_enabled")
            .map_or(true, |v| v == "true")
        {
            sources.push(Box::new(the_muse::TheMuseSource::new()));
        }

        // Remotive - no key required
        if settings
            .get("source_remotive_enabled")
            .map_or(true, |v| v == "true")
        {
            sources.push(Box::new(remotive::RemotiveSource::new()));
        }

        // Arbeitnow - no key required
        if settings
            .get("source_arbeitnow_enabled")
            .map_or(true, |v| v == "true")
        {
            sources.push(Box::new(arbeitnow::ArbeitnowSource::new()));
        }

        // JSearch - requires RapidAPI key
        if let Some(key) = settings.get("rapidapi_key") {
            if !key.is_empty()
                && settings
                    .get("source_jsearch_enabled")
                    .map_or(true, |v| v == "true")
            {
                sources.push(Box::new(jsearch::JSearchSource::new(key.clone())));
            }
        }

        // LinkedIn - scraper
        if settings
            .get("source_linkedin_enabled")
            .map_or(false, |v| v == "true")
        {
            sources.push(Box::new(linkedin::LinkedInSource::new()));
        }

        // Stepstone - scraper
        if settings
            .get("source_stepstone_enabled")
            .map_or(false, |v| v == "true")
        {
            sources.push(Box::new(stepstone::StepstoneSource::new()));
        }

        // Brave Search
        if let Some(key) = settings.get("brave_search_api_key") {
            if !key.is_empty()
                && settings
                    .get("source_brave_search_enabled")
                    .map_or(false, |v| v == "true")
            {
                sources.push(Box::new(brave_search::BraveSearchSource::new(key.clone())));
            }
        }

        Self {
            sources,
            settings: settings.clone(),
        }
    }

    /// Scan all sources concurrently using per-source optimized queries
    pub async fn scan_all_concurrent(&self) -> Vec<(ScanResult, Vec<RawJobListing>)> {
        eprintln!("[scan] Starting concurrent scan with {} sources", self.sources.len());

        let futures: Vec<_> = self
            .sources
            .iter()
            .map(|source| {
                let name = source.name().to_string();
                let query = query_builder::build_queries_for_source(&name, &self.settings);
                eprintln!("[scan] Queuing source: {} with keywords: {:?}", name, query.keywords);
                async move {
                    let name = source.name().to_string();
                    match source.fetch_jobs(&query).await {
                        Ok(jobs) => {
                            let count = jobs.len() as u32;
                            eprintln!("[scan] {} returned {} jobs", name, count);
                            (
                                ScanResult {
                                    source: name,
                                    jobs_found: count,
                                    jobs_new: 0,
                                    error: None,
                                },
                                jobs,
                            )
                        }
                        Err(e) => {
                            eprintln!("[scan] {} ERROR: {}", name, e);
                            (
                                ScanResult {
                                    source: name,
                                    jobs_found: 0,
                                    jobs_new: 0,
                                    error: Some(e.to_string()),
                                },
                                Vec::new(),
                            )
                        }
                    }
                }
            })
            .collect();

        futures::future::join_all(futures).await
    }

    /// Legacy sequential scan (kept for compatibility)
    pub async fn scan_all(&self, query: &SearchQuery) -> Vec<(ScanResult, Vec<RawJobListing>)> {
        eprintln!("[scan] Starting scan with {} sources, keywords: {:?}", self.sources.len(), query.keywords);
        let mut results = Vec::new();
        for source in &self.sources {
            let name = source.name().to_string();
            eprintln!("[scan] Fetching from source: {}", name);
            match source.fetch_jobs(query).await {
                Ok(jobs) => {
                    let count = jobs.len() as u32;
                    eprintln!("[scan] {} returned {} jobs", name, count);
                    results.push((
                        ScanResult {
                            source: name,
                            jobs_found: count,
                            jobs_new: 0,
                            error: None,
                        },
                        jobs,
                    ));
                }
                Err(e) => {
                    eprintln!("[scan] {} ERROR: {}", name, e);
                    results.push((
                        ScanResult {
                            source: name,
                            jobs_found: 0,
                            jobs_new: 0,
                            error: Some(e.to_string()),
                        },
                        Vec::new(),
                    ));
                }
            }
        }
        eprintln!("[scan] Scan complete. {} sources processed.", results.len());
        results
    }

    pub fn source_names(&self) -> Vec<String> {
        self.sources.iter().map(|s| s.name().to_string()).collect()
    }
}
