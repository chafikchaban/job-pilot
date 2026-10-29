use super::MatchResult;
use crate::commands::resume::ParsedResume;
use crate::db::jobs::JobRow;
use regex::Regex;
use std::collections::HashMap;

pub struct UserPreferences {
    pub target_roles: Vec<String>,
    pub preferred_remote_policy: String,
    pub accept_hybrid: bool,
    pub regions: Vec<String>,
    pub german_level: String,
}

fn skill_aliases() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert("js", "javascript");
    m.insert("ts", "typescript");
    m.insert("react.js", "react");
    m.insert("reactjs", "react");
    m.insert("node.js", "node");
    m.insert("nodejs", "node");
    m.insert("vuejs", "vue");
    m.insert("vue.js", "vue");
    m.insert("golang", "go");
    m.insert("c++", "cpp");
    m.insert("c#", "csharp");
    m.insert("postgres", "postgresql");
    m
}

fn normalize_skill(skill: &str) -> String {
    let lower = skill.to_lowercase().trim().to_string();
    let aliases = skill_aliases();
    aliases
        .get(lower.as_str())
        .map(|s| s.to_string())
        .unwrap_or(lower)
}

fn compute_skill_overlap(description: &Option<String>, skills: &[String]) -> f64 {
    if skills.is_empty() {
        return 0.0;
    }
    let desc = description
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let mut matches = 0;
    for skill in skills {
        let normalized = normalize_skill(skill);
        if desc.contains(&normalized) {
            matches += 1;
        }
    }
    matches as f64 / skills.len() as f64
}

fn compute_role_match(title: &str, target_roles: &[String]) -> f64 {
    if target_roles.is_empty() {
        return 0.0;
    }
    let title_words: Vec<String> = title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_string())
        .collect();

    let mut best = 0.0f64;
    for role in target_roles {
        let role_words: Vec<String> = role
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(|w| w.to_string())
            .collect();
        let shared = title_words
            .iter()
            .filter(|w| role_words.contains(w))
            .count();
        let max_len = title_words.len().max(role_words.len());
        if max_len > 0 {
            let score = shared as f64 / max_len as f64;
            if score > best {
                best = score;
            }
        }
    }
    best
}

fn compute_location_match(
    remote_policy: &Option<String>,
    _location: &Option<String>,
    prefs: &UserPreferences,
) -> f64 {
    let policy = remote_policy.as_deref().unwrap_or("");
    match (policy, prefs.preferred_remote_policy.as_str()) {
        ("remote", "remote") => 1.0,
        ("hybrid", _) if prefs.accept_hybrid => 0.7,
        ("hybrid", "remote") => 0.3,
        ("onsite", "remote") => 0.1,
        ("onsite", "onsite") => 1.0,
        _ => 0.5,
    }
}

fn german_level_num(level: &str) -> i32 {
    match level.to_lowercase().as_str() {
        "none" => 0,
        "b1" => 1,
        "b2" => 2,
        "c1" => 3,
        "native" => 4,
        _ => 0,
    }
}

fn compute_language_match(job_level: &Option<String>, user_level: &str) -> f64 {
    let job = job_level.as_deref().unwrap_or("none");
    let job_num = german_level_num(job);
    let user_num = german_level_num(user_level);

    if job_num <= user_num {
        1.0
    } else {
        let diff = job_num - user_num;
        (1.0 - diff as f64 * 0.3).max(0.0)
    }
}

fn compute_experience_match(description: &Option<String>, experience: &[crate::commands::resume::Experience]) -> f64 {
    let desc = description.as_deref().unwrap_or("");
    let re = Regex::new(r"(\d+)\+?\s*years?").unwrap();

    let required_years: Option<u32> = re
        .captures(desc)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok());

    let total_experience: u32 = experience.len() as u32 * 2; // Rough estimate

    match required_years {
        None => 0.7, // No requirement stated
        Some(req) => {
            if total_experience >= req {
                1.0
            } else {
                let gap = req - total_experience;
                (1.0 - gap as f64 * 0.15).max(0.0)
            }
        }
    }
}

pub fn score_job(job: &JobRow, resume: &ParsedResume, prefs: &UserPreferences) -> MatchResult {
    let skill_score = compute_skill_overlap(&job.description, &resume.skills);
    let role_score = compute_role_match(&job.title, &prefs.target_roles);
    let location_score =
        compute_location_match(&job.remote_policy, &job.location, prefs);
    let language_score =
        compute_language_match(&job.german_level_required, &prefs.german_level);
    let experience_score = compute_experience_match(&job.description, &resume.experience);

    let total = skill_score * 0.35
        + role_score * 0.25
        + location_score * 0.15
        + language_score * 0.15
        + experience_score * 0.10;

    MatchResult {
        job_id: job.id,
        total_score: total,
        skill_score,
        role_score,
        location_score,
        language_score,
        experience_score,
    }
}
