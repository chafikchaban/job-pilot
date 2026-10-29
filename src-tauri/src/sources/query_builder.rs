use super::SearchQuery;
use std::collections::HashMap;

/// Generate optimized search queries per source type.
/// - Scrapers get full role titles: "Senior Frontend Engineer"
/// - Search APIs get concise terms: "frontend engineer", "react developer"
/// - Category APIs (The Muse) are handled by the adapter itself
pub fn build_queries_for_source(
    source_name: &str,
    settings: &HashMap<String, String>,
) -> SearchQuery {
    let target_roles: Vec<String> = settings
        .get("target_roles")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_else(|| vec!["software engineer".into()]);

    let regions: Vec<String> = settings
        .get("regions")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_else(|| vec!["Germany".into()]);

    let date_range_days = settings
        .get("posted_since")
        .and_then(|v| match v.as_str() {
            "24h" => Some(1),
            "3d" => Some(3),
            "1w" => Some(7),
            "2w" => Some(14),
            "1m" => Some(30),
            "3m" => Some(90),
            "6m" => Some(180),
            _ => None,
        })
        .or(Some(7)); // default to 1 week

    let language = settings
        .get("languages")
        .and_then(|v| {
            // Stored as comma-separated: "en,de" or "en"
            v.split(',')
                .map(|s| s.trim().to_string())
                .find(|s| !s.is_empty())
        });

    let base_query = SearchQuery {
        location: regions.first().cloned(),
        remote_policy: settings.get("preferred_remote_policy").cloned(),
        date_range_days,
        language,
        page: 1,
        per_page: 25,
        keywords: Vec::new(),
    };

    match source_name {
        // Scrapers: use full role titles for precise results
        "linkedin" | "stepstone" => SearchQuery {
            keywords: if target_roles.is_empty() {
                vec!["software engineer".into()]
            } else {
                target_roles
            },
            ..base_query
        },

        // Search APIs: use concise search terms
        "adzuna" | "jsearch" | "brave_search" => {
            let terms = build_search_terms(&target_roles, settings);
            SearchQuery {
                keywords: terms,
                ..base_query
            }
        }

        // Remotive: use individual relevant terms
        "remotive" => {
            let terms = build_search_terms(&target_roles, settings);
            SearchQuery {
                keywords: terms,
                ..base_query
            }
        }

        // The Muse / Arbeitnow: pass role titles, adapter handles mapping
        "themuse" | "arbeitnow" => SearchQuery {
            keywords: if target_roles.is_empty() {
                vec!["software engineer".into()]
            } else {
                target_roles
            },
            ..base_query
        },

        // Default: pass role titles
        _ => SearchQuery {
            keywords: if target_roles.is_empty() {
                vec!["software engineer".into()]
            } else {
                target_roles
            },
            ..base_query
        },
    }
}

/// Build concise search terms from role titles and skills.
/// E.g., ["Senior Frontend Engineer", "React Native Developer"]
/// → ["frontend engineer", "react developer", "typescript"]
fn build_search_terms(
    target_roles: &[String],
    settings: &HashMap<String, String>,
) -> Vec<String> {
    let mut terms = Vec::new();

    // Extract meaningful terms from role titles
    let stop_words = [
        "senior", "junior", "lead", "staff", "principal", "mid",
        "level", "ii", "iii", "iv", "and", "or", "the", "a", "an",
    ];

    for role in target_roles {
        let words: Vec<&str> = role
            .split_whitespace()
            .filter(|w| !stop_words.contains(&w.to_lowercase().as_str()))
            .collect();

        if words.len() >= 2 {
            terms.push(words.join(" ").to_lowercase());
        } else if !words.is_empty() {
            terms.push(words[0].to_lowercase());
        }
    }

    // Add top skills as additional search terms (limit to 3)
    if let Some(resume_json) = settings.get("resume_skills_cache") {
        if let Ok(skills) = serde_json::from_str::<Vec<String>>(resume_json) {
            for skill in skills.iter().take(3) {
                let term = format!("{} developer", skill.to_lowercase());
                if !terms.contains(&term) {
                    terms.push(term);
                }
            }
        }
    }

    // Deduplicate
    terms.sort();
    terms.dedup();

    if terms.is_empty() {
        vec!["software engineer".into()]
    } else {
        terms
    }
}
