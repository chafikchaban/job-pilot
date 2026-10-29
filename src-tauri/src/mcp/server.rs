use axum::{routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::handlers;

#[derive(Deserialize)]
pub struct JsonRpcRequest {
    pub method: String,
    pub params: Option<serde_json::Value>,
    pub id: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
    pub id: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

pub async fn start_server(port: u16, db_path: String) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db_path = Arc::new(db_path);

    let app = Router::new()
        .route("/health", get(health))
        .route("/rpc", post({
            let db_path = db_path.clone();
            move |body: Json<JsonRpcRequest>| {
                let db_path = db_path.clone();
                async move { handle_rpc(body, &db_path).await }
            }
        }));

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

async fn handle_rpc(
    Json(request): Json<JsonRpcRequest>,
    db_path: &str,
) -> Json<JsonRpcResponse> {
    let result = handlers::handle_method(&request.method, request.params.as_ref(), db_path);

    match result {
        Ok(value) => Json(JsonRpcResponse {
            jsonrpc: "2.0".into(),
            result: Some(value),
            error: None,
            id: request.id,
        }),
        Err(e) => Json(JsonRpcResponse {
            jsonrpc: "2.0".into(),
            result: None,
            error: Some(JsonRpcError {
                code: -32000,
                message: e,
            }),
            id: request.id,
        }),
    }
}
