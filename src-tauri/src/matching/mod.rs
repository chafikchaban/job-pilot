pub mod scorer;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    pub job_id: i64,
    pub total_score: f64,
    pub skill_score: f64,
    pub role_score: f64,
    pub location_score: f64,
    pub language_score: f64,
    pub experience_score: f64,
}
