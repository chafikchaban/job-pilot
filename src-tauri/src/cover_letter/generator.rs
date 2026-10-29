use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ClaudeMessage>,
}

#[derive(Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Deserialize)]
struct ClaudeContent {
    text: String,
}

pub async fn generate(
    api_key: &str,
    prompt: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&ClaudeRequest {
            model: "claude-sonnet-4-5-20250929".into(),
            max_tokens: 2048,
            messages: vec![ClaudeMessage {
                role: "user".into(),
                content: prompt.into(),
            }],
        })
        .send()
        .await?
        .json::<ClaudeResponse>()
        .await?;

    Ok(resp
        .content
        .first()
        .map(|c| c.text.clone())
        .unwrap_or_default())
}
