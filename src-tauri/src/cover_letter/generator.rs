use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<ClaudeMessage>,
}

#[derive(Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

pub async fn generate(
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&ClaudeRequest {
            model: "claude-sonnet-4-5-20250929".into(),
            max_tokens: 2048,
            system: system_prompt.into(),
            messages: vec![ClaudeMessage {
                role: "user".into(),
                content: user_prompt.into(),
            }],
        })
        .send()
        .await?;

    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        return Err(format!("Claude API error ({}): {}", status, body).into());
    }

    let response: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let text = response["content"][0]["text"]
        .as_str()
        .ok_or("No text content in API response")?;

    Ok(text.to_string())
}
