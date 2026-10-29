use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub struct StepstoneSource;

impl StepstoneSource {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl JobSource for StepstoneSource {
    fn name(&self) -> &str {
        "stepstone"
    }
    fn source_type(&self) -> SourceType {
        SourceType::Scraper
    }
    fn requires_api_key(&self) -> bool {
        false
    }

    async fn fetch_jobs(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<RawJobListing>, Box<dyn std::error::Error + Send + Sync>> {
        let input = serde_json::json!({
            "keywords": query.keywords,
            "location": query.location,
            "page": query.page,
            "per_page": query.per_page,
        });

        let mut child = Command::new("node")
            .arg("scripts/stepstone-scraper.js")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(serde_json::to_string(&input)?.as_bytes())
                .await?;
        }

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            child.wait_with_output(),
        )
        .await??;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Stepstone scraper failed: {}", stderr).into());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let jobs: Vec<RawJobListing> = serde_json::from_str(&stdout)?;
        Ok(jobs)
    }
}
