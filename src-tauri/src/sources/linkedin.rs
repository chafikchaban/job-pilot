use super::{JobSource, RawJobListing, SearchQuery, SourceType};
use async_trait::async_trait;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub struct LinkedInSource {
    browser_data_dir: String,
    max_pages: u32,
}

impl LinkedInSource {
    pub fn new() -> Self {
        let browser_data_dir = super::app_data_dir()
            .join("linkedin_browser")
            .to_string_lossy()
            .to_string();
        Self {
            browser_data_dir,
            max_pages: 3,
        }
    }

    pub fn with_settings(settings: &std::collections::HashMap<String, String>) -> Self {
        let browser_data_dir = super::app_data_dir()
            .join("linkedin_browser")
            .to_string_lossy()
            .to_string();
        let max_pages = settings
            .get("linkedin_max_pages")
            .and_then(|v| v.parse().ok())
            .unwrap_or(3u32)
            .min(10);
        Self {
            browser_data_dir,
            max_pages,
        }
    }
}

#[async_trait]
impl JobSource for LinkedInSource {
    fn name(&self) -> &str {
        "linkedin"
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
        let script_path = super::resolve_script_path("linkedin-scraper.js");
        if !script_path.exists() {
            return Err(
                "LinkedIn scraper not available: scripts/linkedin-scraper.js not found."
                    .into(),
            );
        }

        let input = serde_json::json!({
            "keywords": query.keywords,
            "location": query.location,
            "page": query.page,
            "per_page": query.per_page,
            "browser_data_dir": self.browser_data_dir,
            "max_pages": self.max_pages,
        });

        let mut child = Command::new("node")
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                format!("Failed to start LinkedIn scraper: {}", e).into()
            })?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(serde_json::to_string(&input)?.as_bytes())
                .await?;
        }

        let stderr_handle = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            if let Some(stderr) = stderr_handle {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                let mut all_stderr = String::new();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[scan] {}", line);
                    all_stderr.push_str(&line);
                    all_stderr.push('\n');
                }
                all_stderr
            } else {
                String::new()
            }
        });

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(600), // 10 min for multi-page
            child.wait_with_output(),
        )
        .await??;

        let _ = stderr_task.await;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("LinkedIn scraper failed: {}", stderr).into());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let jobs: Vec<RawJobListing> = serde_json::from_str(&stdout)?;
        Ok(jobs)
    }
}
